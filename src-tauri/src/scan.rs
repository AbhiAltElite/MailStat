use crate::db;
use crate::mailmeta::{
    collect_attachments, decode_words, extract_list_unsubscribe, message_category, special_of,
    AttachmentMeta,
};
use crate::models::ScanProgress;
use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub type ImapSession = imap::Session<Box<dyn imap::ImapConnection>>;

#[derive(Clone)]
pub struct ImapCreds {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

pub fn connect(c: &ImapCreds) -> Result<ImapSession, String> {
    let client = imap::ClientBuilder::new(&c.host, c.port)
        .connect()
        .map_err(|e| format!("Connection failed: {e}"))?;
    client
        .login(&c.username, &c.password)
        .map_err(|(e, _)| format!("Login failed: {e}"))
}

const CHUNK: u32 = 500;
const FETCH_QUERY: &str =
    "(UID INTERNALDATE RFC822.SIZE ENVELOPE BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (LIST-UNSUBSCRIBE)])";

struct ParsedMsg {
    uid: u32,
    subject: String,
    from_email: String,
    from_name: String,
    date: Option<i64>,
    size: i64,
    attachments: Vec<AttachmentMeta>,
    list_unsubscribe: Option<String>,
}

fn parse_fetch(f: &imap::types::Fetch) -> Option<ParsedMsg> {
    let uid = f.uid?;
    let size = f.size.unwrap_or(0) as i64;
    let (mut subject, mut from_email, mut from_name) = (String::new(), String::new(), String::new());
    if let Some(env) = f.envelope() {
        if let Some(s) = &env.subject {
            subject = decode_words(&String::from_utf8_lossy(s));
        }
        if let Some(from) = &env.from {
            if let Some(a) = from.first() {
                let mailbox = a
                    .mailbox
                    .as_ref()
                    .map(|m| String::from_utf8_lossy(m).to_string())
                    .unwrap_or_default();
                let host = a
                    .host
                    .as_ref()
                    .map(|h| String::from_utf8_lossy(h).to_string())
                    .unwrap_or_default();
                if !mailbox.is_empty() {
                    from_email = format!("{}@{}", mailbox, host).to_ascii_lowercase();
                }
                if let Some(n) = &a.name {
                    from_name = decode_words(&String::from_utf8_lossy(n));
                }
            }
        }
    }
    let date = f.internal_date().map(|d| d.timestamp());
    let mut attachments = vec![];
    if let Some(bs) = f.bodystructure() {
        collect_attachments(bs, &mut attachments);
    }
    let list_unsubscribe = f.header().and_then(extract_list_unsubscribe);
    Some(ParsedMsg {
        uid,
        subject,
        from_email,
        from_name,
        date,
        size,
        attachments,
        list_unsubscribe,
    })
}

fn insert_batch(
    conn: &mut Connection,
    account_id: i64,
    folder_id: i64,
    msgs: &[ParsedMsg],
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    {
        let mut ins_msg = tx.prepare_cached(
            "INSERT INTO messages (account_id, folder_id, uid, subject, from_email, from_name, date, size, has_attachments, type_cat, list_unsubscribe, norm_subject) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) \
             ON CONFLICT(folder_id, uid) DO UPDATE SET size=excluded.size",
        )?;
        let mut ins_att = tx.prepare_cached(
            "INSERT INTO attachments (message_id, filename, mime, ext, size) VALUES (?1,?2,?3,?4,?5)",
        )?;
        for m in msgs {
            ins_msg.execute(params![
                account_id,
                folder_id,
                m.uid,
                m.subject,
                m.from_email,
                m.from_name,
                m.date,
                m.size,
                !m.attachments.is_empty(),
                message_category(&m.attachments),
                m.list_unsubscribe,
                crate::mailmeta::normalize_subject(&m.subject),
            ])?;
            let msg_id = tx.last_insert_rowid();
            for a in &m.attachments {
                ins_att.execute(params![msg_id, a.filename, a.mime, a.ext, a.size])?;
            }
        }
    }
    tx.commit()
}

/// Full account scan: folders, then metadata of every message, streamed into
/// SQLite with progress events. Never downloads message bodies.
pub fn scan_account(
    app: AppHandle,
    db_path: PathBuf,
    account_id: i64,
    creds: ImapCreds,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut conn = db::open(&db_path).map_err(|e| e.to_string())?;
    let mut session = connect(&creds)?;

    let names = session
        .list(Some(""), Some("*"))
        .map_err(|e| format!("LIST failed: {e}"))?;

    // Collect selectable folders; on Gmail, prefer All Mail/Trash/Spam so a
    // message isn't counted once per label it carries. Gmail only exposes
    // "All Mail" over IMAP when the user has ticked "Show in IMAP" for it in
    // Gmail's label settings, so fall back to every folder (accepting some
    // per-label duplication) when that folder isn't there rather than ending
    // up with an empty scan.
    let mut folders: Vec<String> = names
        .iter()
        .filter(|n| !format!("{:?}", n.attributes()).contains("NoSelect"))
        .map(|n| n.name().to_string())
        .collect();
    let is_gmail_bracket = |f: &str| {
        let lower = f.to_ascii_lowercase();
        lower.starts_with("[gmail]") || lower.starts_with("[google mail]")
    };
    if folders.iter().any(|f| is_gmail_bracket(f)) {
        let all_mail = folders
            .iter()
            .find(|f| is_gmail_bracket(f) && special_of(f) == Some("archive"))
            .cloned();
        if let Some(all_mail) = all_mail {
            let mut keep = vec![all_mail];
            if let Some(t) = folders.iter().find(|f| special_of(f) == Some("trash")).cloned() {
                keep.push(t);
            }
            if let Some(s) = folders.iter().find(|f| special_of(f) == Some("junk")).cloned() {
                keep.push(s);
            }
            folders.retain(|f| keep.contains(f));
        }
        // Otherwise: All Mail isn't exposed over IMAP for this account, so
        // scan every folder as-is, same as a non-Gmail provider.
    }

    if folders.is_empty() {
        let _ = app.emit(
            "scan-error",
            (
                account_id,
                "No folders were found to scan. If this is a Gmail account, check Settings, \
                 See all settings, Labels, and enable \"Show in IMAP\" for at least Inbox."
                    .to_string(),
            ),
        );
        return Ok(());
    }

    let folder_count = folders.len();
    let mut messages_total: u64 = 0;
    let mut bytes_total: u64 = 0;

    for (folder_index, folder) in folders.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            let _ = app.emit("scan-cancelled", account_id);
            return Ok(());
        }
        let mailbox = match session.examine(folder) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let uidvalidity = mailbox.uid_validity.unwrap_or(0) as i64;
        let name = folder.rsplit(['/', '.']).next().unwrap_or(folder).to_string();

        conn.execute(
            "INSERT INTO folders (account_id, path, name, special, uidvalidity, uidnext) VALUES (?1,?2,?3,?4,?5,?6) \
             ON CONFLICT(account_id, path) DO UPDATE SET uidnext=excluded.uidnext",
            params![account_id, folder, name, special_of(folder), uidvalidity, mailbox.uid_next.map(|u| u as i64)],
        )
        .map_err(|e| e.to_string())?;
        let folder_id: i64 = conn
            .query_row(
                "SELECT id FROM folders WHERE account_id=?1 AND path=?2",
                params![account_id, folder],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;

        // If UIDVALIDITY changed, our cached UIDs are meaningless.
        let prev_validity: Option<i64> = conn
            .query_row(
                "SELECT uidvalidity FROM folders WHERE id=?1",
                params![folder_id],
                |r| r.get(0),
            )
            .ok()
            .flatten();
        if prev_validity.is_some() && prev_validity != Some(uidvalidity) {
            conn.execute("DELETE FROM messages WHERE folder_id=?1", params![folder_id])
                .map_err(|e| e.to_string())?;
        }
        conn.execute(
            "UPDATE folders SET uidvalidity=?1 WHERE id=?2",
            params![uidvalidity, folder_id],
        )
        .map_err(|e| e.to_string())?;

        let exists = mailbox.exists;
        if exists == 0 {
            conn.execute("DELETE FROM messages WHERE folder_id=?1", params![folder_id])
                .map_err(|e| e.to_string())?;
            continue;
        }

        let max_uid: Option<i64> = conn
            .query_row(
                "SELECT MAX(uid) FROM messages WHERE folder_id=?1",
                params![folder_id],
                |r| r.get(0),
            )
            .ok()
            .flatten();

        // Reconcile remote deletions: drop local rows whose UID no longer exists.
        if max_uid.is_some() {
            if let Ok(remote_uids) = session.uid_search("ALL") {
                let remote: HashSet<u32> = remote_uids.iter().copied().collect();
                let local: Vec<(i64, i64)> = {
                    let mut stmt = conn
                        .prepare("SELECT id, uid FROM messages WHERE folder_id=?1")
                        .map_err(|e| e.to_string())?;
                    let rows = stmt
                        .query_map(params![folder_id], |r| Ok((r.get(0)?, r.get(1)?)))
                        .map_err(|e| e.to_string())?
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|e| e.to_string())?;
                    rows
                };
                for (id, uid) in local {
                    if !remote.contains(&(uid as u32)) {
                        conn.execute("DELETE FROM messages WHERE id=?1", params![id])
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
        }

        let mut done_in_folder: u32 = 0;
        if let Some(max_uid) = max_uid {
            // Incremental: only new UIDs.
            let range = format!("{}:*", max_uid + 1);
            if let Ok(fetches) = session.uid_fetch(&range, FETCH_QUERY) {
                let msgs: Vec<ParsedMsg> = fetches
                    .iter()
                    .filter_map(parse_fetch)
                    .filter(|m| (m.uid as i64) > max_uid)
                    .collect();
                messages_total += msgs.len() as u64;
                bytes_total += msgs.iter().map(|m| m.size as u64).sum::<u64>();
                done_in_folder = msgs.len() as u32;
                insert_batch(&mut conn, account_id, folder_id, &msgs).map_err(|e| e.to_string())?;
            }
            emit_progress(
                &app, account_id, folder, folder_index, folder_count, done_in_folder,
                done_in_folder, messages_total, bytes_total,
            );
        } else {
            // Full scan in sequence-number chunks.
            let mut start: u32 = 1;
            while start <= exists {
                if cancel.load(Ordering::Relaxed) {
                    let _ = app.emit("scan-cancelled", account_id);
                    return Ok(());
                }
                let end = (start + CHUNK - 1).min(exists);
                let range = format!("{}:{}", start, end);
                match session.fetch(&range, FETCH_QUERY) {
                    Ok(fetches) => {
                        let msgs: Vec<ParsedMsg> = fetches.iter().filter_map(parse_fetch).collect();
                        messages_total += msgs.len() as u64;
                        bytes_total += msgs.iter().map(|m| m.size as u64).sum::<u64>();
                        done_in_folder += msgs.len() as u32;
                        insert_batch(&mut conn, account_id, folder_id, &msgs)
                            .map_err(|e| e.to_string())?;
                    }
                    Err(e) => {
                        // Skip a bad chunk rather than aborting the whole scan.
                        eprintln!("fetch {folder} {range}: {e}");
                    }
                }
                emit_progress(
                    &app, account_id, folder, folder_index, folder_count, done_in_folder, exists,
                    messages_total, bytes_total,
                );
                start = end + 1;
            }
        }
    }

    db::refresh_folder_totals(&conn, account_id).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE accounts SET last_sync=strftime('%s','now') WHERE id=?1",
        params![account_id],
    )
    .map_err(|e| e.to_string())?;
    let _ = session.logout();
    let _ = app.emit("scan-done", account_id);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn emit_progress(
    app: &AppHandle,
    account_id: i64,
    folder: &str,
    folder_index: usize,
    folder_count: usize,
    done_in_folder: u32,
    total_in_folder: u32,
    messages_total: u64,
    bytes_total: u64,
) {
    let _ = app.emit(
        "scan-progress",
        ScanProgress {
            account_id,
            folder: folder.to_string(),
            folder_index,
            folder_count,
            done_in_folder,
            total_in_folder,
            messages_total,
            bytes_total,
        },
    );
}

pub struct ScanRegistry(pub std::sync::Mutex<std::collections::HashMap<i64, Arc<AtomicBool>>>);

impl Default for ScanRegistry {
    fn default() -> Self {
        Self(std::sync::Mutex::new(std::collections::HashMap::new()))
    }
}
