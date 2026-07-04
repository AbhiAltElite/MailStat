//! Provider-independent metadata extraction helpers (unit-tested).

use imap_proto::types::BodyStructure;

#[derive(Debug, Clone, PartialEq)]
pub struct AttachmentMeta {
    pub filename: String,
    pub mime: String,
    pub ext: String,
    pub size: u32,
}

/// Category used for treemap coloring, derived the way a file extension would be.
pub fn categorize(ext: &str, mime: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "heic" | "bmp" | "tiff" | "svg" => "image",
        "pdf" => "pdf",
        "doc" | "docx" | "odt" | "rtf" | "pages" | "txt" | "md" => "doc",
        "xls" | "xlsx" | "csv" | "ods" | "numbers" => "sheet",
        "ppt" | "pptx" | "key" | "odp" => "slides",
        "zip" | "rar" | "7z" | "gz" | "tar" | "bz2" | "dmg" | "iso" => "archive",
        "mp4" | "mov" | "avi" | "mkv" | "webm" | "m4v" => "video",
        "mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg" => "audio",
        "ics" => "calendar",
        "eml" | "msg" => "message",
        _ => {
            let mime = mime.to_ascii_lowercase();
            if mime.starts_with("image/") {
                "image"
            } else if mime.starts_with("video/") {
                "video"
            } else if mime.starts_with("audio/") {
                "audio"
            } else if mime == "application/pdf" {
                "pdf"
            } else if mime.contains("zip") || mime.contains("compressed") {
                "archive"
            } else if mime.contains("spreadsheet") || mime.contains("excel") {
                "sheet"
            } else if mime.contains("presentation") || mime.contains("powerpoint") {
                "slides"
            } else if mime.contains("word") || mime.contains("opendocument.text") {
                "doc"
            } else if mime == "text/calendar" {
                "calendar"
            } else {
                "other"
            }
        }
    }
}

/// Overall category for a message given its attachments.
pub fn message_category(attachments: &[AttachmentMeta]) -> &'static str {
    attachments
        .iter()
        .max_by_key(|a| a.size)
        .map(|a| categorize(&a.ext, &a.mime))
        .unwrap_or("plain")
}

pub fn ext_of(filename: &str) -> String {
    filename
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .filter(|e| e.len() <= 8 && !e.is_empty())
        .unwrap_or_default()
}

/// Decode RFC 2047 encoded words ("=?UTF-8?B?...?=") in headers.
pub fn decode_words(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| *c != '\r' && *c != '\n')
        .collect::<String>()
        .trim()
        .to_string();
    if cleaned.contains("=?") {
        if let Ok((header, _)) = mailparse::parse_header(format!("X: {cleaned}").as_bytes()) {
            return header.get_value();
        }
    }
    cleaned
}

/// Pull the List-Unsubscribe value out of a raw HEADER.FIELDS block.
pub fn extract_list_unsubscribe(header_block: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(header_block);
    let mut value: Option<String> = None;
    for line in text.lines() {
        if let Some(rest) = line
            .to_ascii_lowercase()
            .strip_prefix("list-unsubscribe:")
            .map(|_| &line[17..])
        {
            value = Some(rest.trim().to_string());
        } else if value.is_some() && (line.starts_with(' ') || line.starts_with('\t')) {
            // Unfold continuation lines.
            if let Some(v) = value.as_mut() {
                v.push(' ');
                v.push_str(line.trim());
            }
        } else if value.is_some() {
            break;
        }
    }
    value.filter(|v| !v.is_empty())
}

/// Walk an IMAP BODYSTRUCTURE and collect attachment parts (never bodies).
pub fn collect_attachments(bs: &BodyStructure<'_>, out: &mut Vec<AttachmentMeta>) {
    match bs {
        BodyStructure::Multipart { bodies, .. } => {
            for b in bodies {
                collect_attachments(b, out);
            }
        }
        BodyStructure::Message { body, .. } => {
            collect_attachments(body, out);
        }
        BodyStructure::Basic { common, other, .. } | BodyStructure::Text { common, other, .. } => {
            let mut filename = String::new();
            let mut is_attachment = false;
            if let Some(disp) = &common.disposition {
                if disp.ty.eq_ignore_ascii_case("attachment") {
                    is_attachment = true;
                }
                if let Some(params) = &disp.params {
                    for (k, v) in params {
                        if k.eq_ignore_ascii_case("filename") {
                            filename = decode_words(v);
                        }
                    }
                }
            }
            if filename.is_empty() {
                if let Some(params) = &common.ty.params {
                    for (k, v) in params {
                        if k.eq_ignore_ascii_case("name") {
                            filename = decode_words(v);
                            is_attachment = true;
                        }
                    }
                }
            }
            let mime = format!(
                "{}/{}",
                common.ty.ty.to_ascii_lowercase(),
                common.ty.subtype.to_ascii_lowercase()
            );
            // Inline images etc. count too: anything with a filename or an
            // attachment disposition, but never the text body itself.
            if is_attachment && !mime.starts_with("text/") || (!filename.is_empty() && is_attachment)
            {
                out.push(AttachmentMeta {
                    ext: ext_of(&filename),
                    filename,
                    mime,
                    size: other.octets,
                });
            }
        }
    }
}

/// Normalize a subject for threading: strip reply/forward prefixes,
/// lowercase, and collapse whitespace.
pub fn normalize_subject(s: &str) -> String {
    let mut t = s.trim();
    loop {
        let lower = t.to_ascii_lowercase();
        let mut next = None;
        for p in ["re:", "fw:", "fwd:", "aw:", "sv:"] {
            if lower.starts_with(p) {
                next = Some(t[p.len()..].trim_start());
                break;
            }
        }
        match next {
            Some(rest) => t = rest,
            None => break,
        }
    }
    t.to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Classify a mailbox path into a special role, if any.
pub fn special_of(path: &str) -> Option<&'static str> {
    let p = path.to_ascii_lowercase();
    let leaf = p.rsplit(['/', '.']).next().unwrap_or(&p);
    if leaf == "trash" || leaf == "deleted items" || leaf == "bin" || leaf == "deleted messages" {
        Some("trash")
    } else if leaf == "archive" || leaf == "all mail" || leaf == "archives" {
        Some("archive")
    } else if leaf.contains("sent") {
        Some("sent")
    } else if leaf == "junk" || leaf == "spam" || leaf == "junk e-mail" {
        Some("junk")
    } else if leaf == "drafts" || leaf == "draft" {
        Some("drafts")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::borrow::Cow;

    #[test]
    fn categorize_by_ext_and_mime() {
        assert_eq!(categorize("PDF", ""), "pdf");
        assert_eq!(categorize("jpeg", ""), "image");
        assert_eq!(categorize("", "video/mp4"), "video");
        assert_eq!(categorize("", "application/vnd.ms-excel"), "sheet");
        assert_eq!(categorize("xyz", "application/octet-stream"), "other");
    }

    #[test]
    fn ext_extraction() {
        assert_eq!(ext_of("report.final.PDF"), "pdf");
        assert_eq!(ext_of("noext"), "");
        assert_eq!(ext_of("weird.reallylongextension"), "");
    }

    #[test]
    fn decodes_rfc2047() {
        assert_eq!(
            decode_words("=?UTF-8?B?SGVsbG8gd29ybGQ=?="),
            "Hello world"
        );
        assert_eq!(decode_words("  plain subject "), "plain subject");
    }

    #[test]
    fn list_unsubscribe_extraction_with_folding() {
        let hdr = b"List-Unsubscribe: <https://ex.com/u?x=1>,\r\n <mailto:u@ex.com>\r\nX-Other: y\r\n";
        assert_eq!(
            extract_list_unsubscribe(hdr).as_deref(),
            Some("<https://ex.com/u?x=1>, <mailto:u@ex.com>")
        );
        assert_eq!(extract_list_unsubscribe(b"Subject: hi\r\n"), None);
    }

    #[test]
    fn message_category_uses_largest_attachment() {
        let atts = vec![
            AttachmentMeta {
                filename: "a.jpg".into(),
                mime: "image/jpeg".into(),
                ext: "jpg".into(),
                size: 10,
            },
            AttachmentMeta {
                filename: "b.zip".into(),
                mime: "application/zip".into(),
                ext: "zip".into(),
                size: 999,
            },
        ];
        assert_eq!(message_category(&atts), "archive");
        assert_eq!(message_category(&[]), "plain");
    }

    #[test]
    fn subject_normalization() {
        assert_eq!(normalize_subject("Re: RE: Fwd: Budget  plan "), "budget plan");
        assert_eq!(normalize_subject("Budget plan"), "budget plan");
        assert_eq!(normalize_subject("  "), "");
        assert_eq!(normalize_subject("Recap notes"), "recap notes");
    }

    #[test]
    fn special_folder_detection() {
        assert_eq!(special_of("[Gmail]/Trash"), Some("trash"));
        assert_eq!(special_of("INBOX/Deleted Items"), Some("trash"));
        assert_eq!(special_of("[Gmail]/All Mail"), Some("archive"));
        assert_eq!(special_of("Sent Messages"), Some("sent"));
        assert_eq!(special_of("INBOX"), None);
    }

    #[test]
    fn bodystructure_walk_finds_attachments() {
        use imap_proto::types::{
            BodyContentCommon, BodyContentSinglePart, ContentDisposition, ContentType,
        };
        let part = BodyStructure::Basic {
            common: BodyContentCommon {
                ty: ContentType {
                    ty: Cow::Borrowed("APPLICATION"),
                    subtype: Cow::Borrowed("PDF"),
                    params: None,
                },
                disposition: Some(ContentDisposition {
                    ty: Cow::Borrowed("ATTACHMENT"),
                    params: Some(vec![(
                        Cow::Borrowed("FILENAME"),
                        Cow::Borrowed("invoice.pdf"),
                    )]),
                }),
                language: None,
                location: None,
            },
            other: BodyContentSinglePart {
                id: None,
                md5: None,
                transfer_encoding: imap_proto::types::ContentEncoding::Base64,
                description: None,
                octets: 4321,
            },
            extension: None,
        };
        let text = BodyStructure::Text {
            common: BodyContentCommon {
                ty: ContentType {
                    ty: Cow::Borrowed("TEXT"),
                    subtype: Cow::Borrowed("PLAIN"),
                    params: None,
                },
                disposition: None,
                language: None,
                location: None,
            },
            other: BodyContentSinglePart {
                id: None,
                md5: None,
                transfer_encoding: imap_proto::types::ContentEncoding::SevenBit,
                description: None,
                octets: 120,
            },
            lines: 4,
            extension: None,
        };
        let root = BodyStructure::Multipart {
            common: BodyContentCommon {
                ty: ContentType {
                    ty: Cow::Borrowed("MULTIPART"),
                    subtype: Cow::Borrowed("MIXED"),
                    params: None,
                },
                disposition: None,
                language: None,
                location: None,
            },
            bodies: vec![text, part],
            extension: None,
        };
        let mut out = vec![];
        collect_attachments(&root, &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].filename, "invoice.pdf");
        assert_eq!(out[0].ext, "pdf");
        assert_eq!(out[0].size, 4321);
        assert_eq!(message_category(&out), "pdf");
    }
}
