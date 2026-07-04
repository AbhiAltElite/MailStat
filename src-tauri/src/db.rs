use rusqlite::{params, Connection};
use std::path::Path;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY,
            kind TEXT NOT NULL,             -- 'imap' | 'demo'
            email TEXT NOT NULL,
            label TEXT NOT NULL,
            host TEXT NOT NULL DEFAULT '',
            port INTEGER NOT NULL DEFAULT 993,
            username TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            last_sync INTEGER
        );
        CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY,
            account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            name TEXT NOT NULL,
            special TEXT,                   -- 'trash' | 'archive' | 'sent' | 'junk' | 'drafts'
            uidvalidity INTEGER,
            uidnext INTEGER,
            msg_count INTEGER NOT NULL DEFAULT 0,
            total_size INTEGER NOT NULL DEFAULT 0,
            UNIQUE(account_id, path)
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY,
            account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
            uid INTEGER NOT NULL,
            subject TEXT NOT NULL DEFAULT '',
            from_email TEXT NOT NULL DEFAULT '',
            from_name TEXT NOT NULL DEFAULT '',
            date INTEGER,                   -- unix seconds
            size INTEGER NOT NULL DEFAULT 0,
            flags TEXT NOT NULL DEFAULT '',
            has_attachments INTEGER NOT NULL DEFAULT 0,
            type_cat TEXT NOT NULL DEFAULT 'plain',
            list_unsubscribe TEXT,
            UNIQUE(folder_id, uid)
        );
        CREATE INDEX IF NOT EXISTS idx_messages_account ON messages(account_id);
        CREATE INDEX IF NOT EXISTS idx_messages_folder ON messages(folder_id);
        CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(account_id, from_email);
        CREATE INDEX IF NOT EXISTS idx_messages_size ON messages(account_id, size DESC);
        CREATE TABLE IF NOT EXISTS attachments (
            id INTEGER PRIMARY KEY,
            message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            filename TEXT NOT NULL DEFAULT '',
            mime TEXT NOT NULL DEFAULT '',
            ext TEXT NOT NULL DEFAULT '',
            size INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
        "#,
    )
}

/// Recompute per-folder counters after inserts/deletes.
pub fn refresh_folder_totals(conn: &Connection, account_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        r#"UPDATE folders SET
            msg_count = (SELECT COUNT(*) FROM messages m WHERE m.folder_id = folders.id),
            total_size = (SELECT COALESCE(SUM(size),0) FROM messages m WHERE m.folder_id = folders.id)
           WHERE account_id = ?1"#,
        params![account_id],
    )?;
    Ok(())
}
