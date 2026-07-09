use crate::models::ActionResult;
use crate::scan::{connect, ImapCreds, ImapSession};
use rusqlite::{params, Connection};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MailAction {
    Trash,
    Archive,
    Delete,
}

impl MailAction {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "trash" => Ok(Self::Trash),
            "archive" => Ok(Self::Archive),
            "delete" => Ok(Self::Delete),
            _ => Err(format!("unknown action: {s}")),
        }
    }
}

fn special_folder(conn: &Connection, account_id: i64, special: &str) -> Option<String> {
    conn.query_row(
        "SELECT path FROM folders WHERE account_id=?1 AND special=?2 LIMIT 1",
        params![account_id, special],
        |r| r.get(0),
    )
    .ok()
}

/// Compress sorted UIDs into an IMAP set string like "1:5,9,12:14".
pub fn uid_set(mut uids: Vec<u32>) -> String {
    uids.sort_unstable();
    uids.dedup();
    let mut parts: Vec<String> = vec![];
    let mut i = 0;
    while i < uids.len() {
        let start = uids[i];
        let mut end = start;
        while i + 1 < uids.len() && uids[i + 1] == end + 1 {
            i += 1;
            end = uids[i];
        }
        parts.push(if start == end {
            start.to_string()
        } else {
            format!("{start}:{end}")
        });
        i += 1;
    }
    parts.join(",")
}

/// Permanently remove exactly the given UIDs. Prefer UID EXPUNGE (RFC 4315
/// UIDPLUS), which only expunges the UIDs we name, so any *other* message the
/// user happened to have flagged \Deleted in this folder is left untouched.
/// Fall back to a plain EXPUNGE only if the server lacks UIDPLUS.
fn expunge_uids(session: &mut ImapSession, uids: &str) -> Result<(), String> {
    if session.uid_expunge(uids).is_ok() {
        return Ok(());
    }
    session.expunge().map_err(|e| e.to_string())?;
    Ok(())
}

fn move_uids(
    session: &mut ImapSession,
    uids: &str,
    dest: &str,
) -> Result<(), String> {
    // MOVE where supported, otherwise COPY + \Deleted + EXPUNGE.
    if session.uid_mv(uids, dest).is_ok() {
        return Ok(());
    }
    session.uid_copy(uids, dest).map_err(|e| e.to_string())?;
    session
        .uid_store(uids, "+FLAGS.SILENT (\\Deleted)")
        .map_err(|e| e.to_string())?;
    expunge_uids(session, uids)
}

/// Apply an action to a set of local message ids: execute remotely per folder,
/// then update the local cache.
pub fn perform(
    conn: &mut Connection,
    account_id: i64,
    creds: Option<ImapCreds>,
    message_ids: &[i64],
    action: MailAction,
) -> Result<ActionResult, String> {
    if message_ids.is_empty() {
        return Ok(ActionResult { affected: 0, bytes: 0 });
    }

    // Group target messages by folder path. Carry each folder's UIDVALIDITY
    // (captured at scan time) so we can confirm, before touching anything,
    // that the cached UIDs still name the same messages on the server.
    let mut by_folder: HashMap<(i64, String), Vec<(i64, u32, i64)>> = HashMap::new();
    let mut folder_validity: HashMap<i64, Option<i64>> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT m.id, m.uid, m.size, f.id, f.path, f.uidvalidity FROM messages m \
                 JOIN folders f ON f.id = m.folder_id WHERE m.id = ?1 AND m.account_id = ?2",
            )
            .map_err(|e| e.to_string())?;
        for id in message_ids {
            if let Ok((mid, uid, size, fid, fpath, validity)) =
                stmt.query_row(params![id, account_id], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, i64>(1)? as u32,
                        r.get::<_, i64>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, String>(4)?,
                        r.get::<_, Option<i64>>(5)?,
                    ))
                })
            {
                by_folder.entry((fid, fpath)).or_default().push((mid, uid, size));
                folder_validity.insert(fid, validity);
            }
        }
    }

    let kind: String = conn
        .query_row(
            "SELECT kind FROM accounts WHERE id=?1",
            params![account_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let mut affected = 0i64;
    let mut bytes = 0i64;

    if kind == "demo" {
        // Demo accounts have no server; just mutate the local cache.
        for ((_fid, _), msgs) in &by_folder {
            for (mid, _uid, size) in msgs {
                conn.execute("DELETE FROM messages WHERE id=?1", params![mid])
                    .map_err(|e| e.to_string())?;
                affected += 1;
                bytes += size;
            }
        }
    } else {
        let creds = creds.ok_or("missing credentials")?;
        let mut session = connect(&creds)?;
        let trash = special_folder(conn, account_id, "trash");
        let archive = special_folder(conn, account_id, "archive");

        for ((fid, fpath), msgs) in &by_folder {
            let mailbox = session.select(fpath).map_err(|e| e.to_string())?;

            // Guard against acting on stale UIDs. IMAP UIDs are only meaningful
            // within a fixed UIDVALIDITY; if the server reset it (mailbox
            // recreated, restored from backup, etc.) since our scan, the cached
            // UIDs now point at *different* messages. Refuse rather than risk
            // trashing or deleting the wrong mail — the user can rescan and retry.
            let stored = folder_validity.get(fid).copied().flatten();
            if let (Some(stored), Some(current)) = (stored, mailbox.uid_validity) {
                if stored != current as i64 {
                    let _ = session.logout();
                    return Err(format!(
                        "The folder \"{fpath}\" changed on the server since the last scan, so \
                         this action was cancelled to avoid touching the wrong messages. \
                         Rescan this account and try again."
                    ));
                }
            }

            let uids = uid_set(msgs.iter().map(|(_, u, _)| *u).collect());
            match action {
                MailAction::Trash => {
                    let dest = trash.clone().ok_or("no Trash folder found on server")?;
                    if fpath == &dest {
                        continue; // already in trash
                    }
                    move_uids(&mut session, &uids, &dest)?;
                }
                MailAction::Archive => {
                    let dest = archive.clone().ok_or("no Archive folder found on server")?;
                    if fpath == &dest {
                        continue;
                    }
                    move_uids(&mut session, &uids, &dest)?;
                }
                MailAction::Delete => {
                    session
                        .uid_store(&uids, "+FLAGS.SILENT (\\Deleted)")
                        .map_err(|e| e.to_string())?;
                    expunge_uids(&mut session, &uids)?;
                }
            }
            for (mid, _uid, size) in msgs {
                conn.execute("DELETE FROM messages WHERE id=?1", params![mid])
                    .map_err(|e| e.to_string())?;
                affected += 1;
                bytes += size;
            }
        }
        let _ = session.logout();
    }

    crate::db::refresh_folder_totals(conn, account_id).map_err(|e| e.to_string())?;
    Ok(ActionResult { affected, bytes })
}

#[cfg(test)]
mod tests {
    use super::uid_set;

    #[test]
    fn uid_set_compression() {
        assert_eq!(uid_set(vec![1, 2, 3, 5, 9, 10]), "1:3,5,9:10");
        assert_eq!(uid_set(vec![7]), "7");
        assert_eq!(uid_set(vec![3, 1, 2, 2]), "1:3");
        assert_eq!(uid_set(vec![]), "");
    }
}
