pub mod actions;
pub mod content;
pub mod db;
pub mod demo;
pub mod mailmeta;
pub mod models;
pub mod queries;
pub mod scan;
pub mod secrets;

use models::*;
use rusqlite::params;
use scan::{ImapCreds, ScanRegistry};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

struct AppState {
    db_path: PathBuf,
    scans: ScanRegistry,
}

fn open_db(state: &AppState) -> Result<rusqlite::Connection, String> {
    db::open(&state.db_path).map_err(|e| e.to_string())
}

/// The only grouping dimensions queries.rs knows how to build SQL for, plus
/// "msg" which addresses one specific message tile directly (handled before
/// any SQL is built, in queries::ids_for_path). dim_exprs()/seg_filter()
/// already fall back to a harmless no-op for any other value, so this isn't
/// an injection guard, but it turns an unrecognized dimension into a clear
/// error instead of silently grouping everything into one bucket or
/// dropping a filter.
const VALID_DIMS: [&str; 5] = ["folder", "sender", "type", "year", "msg"];

fn check_dims(group_by: &[String], path: &[PathSeg]) -> Result<(), String> {
    for d in group_by.iter().chain(path.iter().map(|p| &p.dim)) {
        if !VALID_DIMS.contains(&d.as_str()) {
            return Err(format!("Unknown grouping dimension: {d}"));
        }
    }
    Ok(())
}

fn creds_for(conn: &rusqlite::Connection, account_id: i64) -> Result<ImapCreds, String> {
    let (host, port, username): (String, u16, String) = conn
        .query_row(
            "SELECT host, port, username FROM accounts WHERE id=?1",
            params![account_id],
            |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as u16, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    let password = secrets::get_password(account_id)?;
    Ok(ImapCreds { host, port, username, password })
}

#[tauri::command]
fn list_accounts(state: State<AppState>) -> Result<Vec<Account>, String> {
    let conn = open_db(&state)?;
    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.kind, a.email, a.label, a.host, a.port, a.username, a.last_sync, \
             (SELECT COUNT(*) FROM messages m WHERE m.account_id=a.id), \
             (SELECT COALESCE(SUM(size),0) FROM messages m WHERE m.account_id=a.id) \
             FROM accounts a ORDER BY a.id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Account {
                id: r.get(0)?,
                kind: r.get(1)?,
                email: r.get(2)?,
                label: r.get(3)?,
                host: r.get(4)?,
                port: r.get::<_, i64>(5)? as u16,
                username: r.get(6)?,
                last_sync: r.get(7)?,
                msg_count: r.get(8)?,
                total_size: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
async fn add_account(state: State<'_, AppState>, cfg: NewAccount) -> Result<i64, String> {
    if cfg.email.trim().is_empty() {
        return Err("Enter an email address".into());
    }
    {
        let conn = open_db(&state)?;
        if db::imap_account_exists(&conn, &cfg.email).map_err(|e| e.to_string())? {
            return Err(format!("{} is already added", cfg.email.trim()));
        }
    }

    // Verify credentials before persisting anything.
    let creds = ImapCreds {
        host: cfg.host.clone(),
        port: cfg.port,
        username: cfg.username.clone(),
        password: cfg.password.clone(),
    };
    let creds2 = creds.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = scan::connect(&creds2)?;
        let _ = s.logout();
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;

    let conn = open_db(&state)?;
    conn.execute(
        "INSERT INTO accounts (kind, email, label, host, port, username, created_at) \
         VALUES ('imap', ?1, ?2, ?3, ?4, ?5, strftime('%s','now'))",
        params![cfg.email, cfg.label, cfg.host, cfg.port as i64, cfg.username],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    secrets::store_password(id, &cfg.password)?;
    Ok(id)
}

#[tauri::command]
fn remove_account(state: State<AppState>, account_id: i64) -> Result<(), String> {
    let conn = open_db(&state)?;
    conn.execute("DELETE FROM accounts WHERE id=?1", params![account_id])
        .map_err(|e| e.to_string())?;
    secrets::delete_password(account_id);
    Ok(())
}

#[tauri::command]
fn start_scan(app: AppHandle, state: State<AppState>, account_id: i64) -> Result<(), String> {
    let conn = open_db(&state)?;
    let kind: String = conn
        .query_row("SELECT kind FROM accounts WHERE id=?1", params![account_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if kind == "demo" {
        return Err("Demo accounts have no server to scan".into());
    }
    let creds = creds_for(&conn, account_id)?;

    let cancel = Arc::new(AtomicBool::new(false));
    state
        .scans
        .0
        .lock()
        .unwrap()
        .insert(account_id, cancel.clone());
    let db_path = state.db_path.clone();
    std::thread::spawn(move || {
        if let Err(e) = scan::scan_account(app.clone(), db_path, account_id, creds, cancel) {
            let _ = tauri::Emitter::emit(&app, "scan-error", (account_id, e));
        }
    });
    Ok(())
}

#[tauri::command]
fn cancel_scan(state: State<AppState>, account_id: i64) {
    if let Some(flag) = state.scans.0.lock().unwrap().get(&account_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
fn get_folders(state: State<AppState>, account_id: i64) -> Result<Vec<FolderInfo>, String> {
    let conn = open_db(&state)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, path, name, special, msg_count, total_size FROM folders \
             WHERE account_id=?1 ORDER BY total_size DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![account_id], |r| {
            Ok(FolderInfo {
                id: r.get(0)?,
                path: r.get(1)?,
                name: r.get(2)?,
                special: r.get(3)?,
                msg_count: r.get(4)?,
                total_size: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
fn get_treemap(
    state: State<AppState>,
    account_id: i64,
    group_by: Vec<String>,
    path: Vec<PathSeg>,
) -> Result<Vec<TreeNode>, String> {
    check_dims(&group_by, &path)?;
    let conn = open_db(&state)?;
    queries::get_treemap(&conn, account_id, &group_by, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_top_senders(state: State<AppState>, account_id: i64, limit: usize) -> Result<Vec<SenderStat>, String> {
    let conn = open_db(&state)?;
    queries::top_senders(&conn, account_id, limit).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_unsubscribe_candidates(state: State<AppState>, account_id: i64, limit: usize) -> Result<Vec<SenderStat>, String> {
    let conn = open_db(&state)?;
    queries::unsubscribe_candidates(&conn, account_id, limit).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_largest_messages(state: State<AppState>, account_id: i64, limit: usize) -> Result<Vec<MessageRow>, String> {
    let conn = open_db(&state)?;
    queries::largest_messages(&conn, account_id, limit).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_type_stats(state: State<AppState>, account_id: i64) -> Result<Vec<TypeStat>, String> {
    let conn = open_db(&state)?;
    queries::type_stats(&conn, account_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_message_detail(state: State<AppState>, message_id: i64) -> Result<MessageDetail, String> {
    let conn = open_db(&state)?;
    queries::message_detail(&conn, message_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_account_stats(state: State<AppState>, account_id: i64) -> Result<AccountStats, String> {
    let conn = open_db(&state)?;
    queries::account_stats(&conn, account_id).map_err(|e| e.to_string())
}

/// Fetch the full content of exactly one message, live, on demand. Never
/// runs during a scan and the result is never written to the local cache.
#[tauri::command]
async fn get_message_body(state: State<'_, AppState>, message_id: i64) -> Result<MessageBody, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db::open(&db_path).map_err(|e| e.to_string())?;
        let (account_id, folder_path, uid, kind, size): (i64, String, i64, String, i64) = conn
            .query_row(
                "SELECT m.account_id, f.path, m.uid, a.kind, m.size FROM messages m \
                 JOIN folders f ON f.id = m.folder_id \
                 JOIN accounts a ON a.id = m.account_id \
                 WHERE m.id = ?1",
                params![message_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .map_err(|e| e.to_string())?;

        if kind == "demo" {
            return Ok(content::demo_body());
        }

        // Refuse before fetching: a message's already-known size (from the
        // scan) could be huge, and BODY.PEEK[] pulls the whole thing into
        // memory with no size limit of its own.
        if size > content::MAX_FETCH_BYTES {
            return Err(format!(
                "This message is {} MB, too large to preview here. Open it in your provider's webmail instead.",
                size / 1_000_000
            ));
        }

        let creds = creds_for(&conn, account_id)?;
        let mut session = scan::connect(&creds)?;
        session.select(&folder_path).map_err(|e| e.to_string())?;
        let fetches = session
            .uid_fetch(uid.to_string(), "BODY.PEEK[]")
            .map_err(|e| e.to_string())?;
        let raw = fetches
            .iter()
            .find_map(|f| f.body())
            .ok_or_else(|| "The server did not return this message's content".to_string())?;
        let body = content::extract_body(raw);
        let _ = session.logout();
        Ok(body)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Resolve the message ids under a treemap node (drill path), so the UI can
/// preview and then act on "everything inside this tile".
#[tauri::command]
fn ids_for_path(state: State<AppState>, account_id: i64, path: Vec<PathSeg>) -> Result<Vec<i64>, String> {
    check_dims(&[], &path)?;
    let conn = open_db(&state)?;
    queries::ids_for_path(&conn, account_id, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn ids_for_senders(state: State<AppState>, account_id: i64, senders: Vec<String>) -> Result<Vec<i64>, String> {
    let conn = open_db(&state)?;
    let mut ids = vec![];
    let mut stmt = conn
        .prepare("SELECT id FROM messages WHERE account_id=?1 AND from_email=?2")
        .map_err(|e| e.to_string())?;
    for s in senders {
        let rows = stmt
            .query_map(params![account_id, s], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        for r in rows {
            ids.push(r.map_err(|e| e.to_string())?);
        }
    }
    Ok(ids)
}

#[tauri::command]
async fn perform_action(
    state: State<'_, AppState>,
    account_id: i64,
    message_ids: Vec<i64>,
    action: String,
) -> Result<ActionResult, String> {
    let action = actions::MailAction::parse(&action)?;
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = db::open(&db_path).map_err(|e| e.to_string())?;
        let kind: String = conn
            .query_row("SELECT kind FROM accounts WHERE id=?1", params![account_id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let creds = if kind == "demo" { None } else { Some(creds_for(&conn, account_id)?) };
        actions::perform(&mut conn, account_id, creds, &message_ids, action)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn seed_demo(state: State<AppState>) -> Result<i64, String> {
    let mut conn = open_db(&state)?;
    demo::seed(&mut conn)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("mailstat.db");
            let conn = db::open(&db_path)?;
            db::init(&conn)?;
            app.manage(AppState {
                db_path,
                scans: ScanRegistry::default(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_accounts,
            add_account,
            remove_account,
            start_scan,
            cancel_scan,
            get_folders,
            get_treemap,
            get_top_senders,
            get_unsubscribe_candidates,
            get_largest_messages,
            get_type_stats,
            get_account_stats,
            get_message_detail,
            get_message_body,
            ids_for_path,
            ids_for_senders,
            perform_action,
            seed_demo
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_dims_accepts_known_dimensions() {
        let group_by = vec!["folder".to_string(), "sender".to_string()];
        let path = vec![
            PathSeg { dim: "folder".into(), key: "1".into() },
            PathSeg { dim: "year".into(), key: "2024".into() },
            PathSeg { dim: "msg".into(), key: "m:5".into() },
        ];
        assert!(check_dims(&group_by, &path).is_ok());
    }

    #[test]
    fn check_dims_rejects_unknown_dimension() {
        let path = vec![PathSeg { dim: "'; DROP TABLE messages; --".into(), key: "x".into() }];
        let err = check_dims(&[], &path).unwrap_err();
        assert!(err.contains("Unknown grouping dimension"));
    }
}
