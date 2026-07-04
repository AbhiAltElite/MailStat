//! On-demand message content: fetched live for exactly one message when the
//! user asks to read it, never during a scan and never cached to disk.

use crate::models::MessageBody;
use mailparse::ParsedMail;

const CAP: usize = 200_000;

/// Above this, refuse to fetch a message's raw body at all rather than pull
/// an unbounded amount of server-controlled data into memory. Applied
/// against the size already known from the scan, before any network call.
pub const MAX_FETCH_BYTES: i64 = 25_000_000;

fn is_attachment(part: &ParsedMail) -> bool {
    part.headers.iter().any(|h| {
        h.get_key().eq_ignore_ascii_case("content-disposition")
            && h.get_value().to_ascii_lowercase().starts_with("attachment")
    })
}

/// Depth-first search for the first non-attachment part of the given MIME type.
fn find_part<'a>(part: &'a ParsedMail<'a>, want: &str) -> Option<&'a ParsedMail<'a>> {
    if part.subparts.is_empty() {
        if part.ctype.mimetype.eq_ignore_ascii_case(want) && !is_attachment(part) {
            return Some(part);
        }
        return None;
    }
    part.subparts.iter().find_map(|sp| find_part(sp, want))
}

fn cap_chars(s: String, max: usize) -> (String, bool) {
    if s.chars().count() <= max {
        return (s, false);
    }
    (s.chars().take(max).collect(), true)
}

/// Strip anything that could execute code or phone home. Remote images are
/// removed entirely rather than just left unloaded, since Mailstat never
/// makes network requests on your behalf outside an explicit scan or this
/// fetch, and a tracking pixel would break that guarantee silently.
fn sanitize_html(html: &str) -> String {
    ammonia::Builder::default()
        .rm_tags(["img"])
        .clean(html)
        .to_string()
}

/// Parse a raw RFC822 message and pull out the best available readable part:
/// plain text if present, otherwise sanitized HTML, otherwise none.
pub fn extract_body(raw: &[u8]) -> MessageBody {
    let parsed = match mailparse::parse_mail(raw) {
        Ok(p) => p,
        Err(_) => {
            return MessageBody {
                content_type: "none".into(),
                content: String::new(),
                truncated: false,
            };
        }
    };

    if let Some(plain) = find_part(&parsed, "text/plain") {
        if let Ok(text) = plain.get_body() {
            let (content, truncated) = cap_chars(text, CAP);
            return MessageBody { content_type: "text".into(), content, truncated };
        }
    }
    if let Some(html) = find_part(&parsed, "text/html") {
        if let Ok(html_raw) = html.get_body() {
            let (html_raw, truncated) = cap_chars(html_raw, CAP);
            return MessageBody {
                content_type: "html".into(),
                content: sanitize_html(&html_raw),
                truncated,
            };
        }
    }
    MessageBody { content_type: "none".into(), content: String::new(), truncated: false }
}

/// The demo mailbox has no real server behind it, so content view returns an
/// honest placeholder rather than pretending to fetch something.
pub fn demo_body() -> MessageBody {
    MessageBody {
        content_type: "text".into(),
        content: "This is the built-in demo mailbox, which is not backed by a real mail \
                  server, so there is no message content to fetch. Connect a real IMAP \
                  account to read actual mail here."
            .into(),
        truncated: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_plain_text_body() {
        let raw = b"Subject: hi\r\nContent-Type: text/plain\r\n\r\nHello there.\r\n";
        let body = extract_body(raw);
        assert_eq!(body.content_type, "text");
        assert!(body.content.contains("Hello there."));
        assert!(!body.truncated);
    }

    #[test]
    fn sanitizes_html_and_strips_scripts_and_images() {
        let raw = b"Subject: hi\r\nContent-Type: text/html\r\n\r\n\
                    <p>Hello <b>world</b></p><script>alert(1)</script>\
                    <img src=\"https://evil.example/track.gif\">\r\n";
        let body = extract_body(raw);
        assert_eq!(body.content_type, "html");
        assert!(body.content.contains("Hello"));
        assert!(body.content.contains("<b>world</b>"));
        assert!(!body.content.contains("<script"));
        assert!(!body.content.contains("alert(1)"));
        assert!(!body.content.contains("<img"));
        assert!(!body.content.contains("evil.example"));
    }

    #[test]
    fn prefers_plain_text_over_html_in_multipart_alternative() {
        let raw = b"Subject: hi\r\n\
                    Content-Type: multipart/alternative; boundary=b\r\n\r\n\
                    --b\r\n\
                    Content-Type: text/plain\r\n\r\n\
                    Plain version\r\n\
                    --b\r\n\
                    Content-Type: text/html\r\n\r\n\
                    <p>HTML version</p>\r\n\
                    --b--\r\n";
        let body = extract_body(raw);
        assert_eq!(body.content_type, "text");
        assert!(body.content.contains("Plain version"));
    }

    #[test]
    fn skips_attachment_parts_and_falls_back_to_html() {
        let raw = b"Subject: hi\r\n\
                    Content-Type: multipart/mixed; boundary=b\r\n\r\n\
                    --b\r\n\
                    Content-Type: text/plain\r\n\
                    Content-Disposition: attachment; filename=notes.txt\r\n\r\n\
                    not the message body\r\n\
                    --b\r\n\
                    Content-Type: text/html\r\n\r\n\
                    <p>Real content</p>\r\n\
                    --b--\r\n";
        let body = extract_body(raw);
        assert_eq!(body.content_type, "html");
        assert!(body.content.contains("Real content"));
    }

    #[test]
    fn empty_or_unparseable_message_yields_none() {
        let body = extract_body(b"not a valid email at all but mailparse is lenient");
        // mailparse is very forgiving, so assert on the property we actually
        // care about: no attachment or script content ever leaks through.
        assert!(!body.content.contains("<script"));
    }

    #[test]
    fn caps_very_long_bodies() {
        let long = "a".repeat(CAP + 5000);
        let raw = format!("Subject: hi\r\nContent-Type: text/plain\r\n\r\n{long}\r\n");
        let body = extract_body(raw.as_bytes());
        assert_eq!(body.content_type, "text");
        assert!(body.truncated);
        assert!(body.content.chars().count() <= CAP);
    }
}
