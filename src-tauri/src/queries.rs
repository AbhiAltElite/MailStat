use crate::models::*;
use rusqlite::{params_from_iter, types::Value, Connection};

const CHILD_CAP: usize = 300;
const GRANDCHILD_CAP: usize = 25;
const MSG_CAP: usize = 1200;

/// Translate a drill-path segment into a WHERE clause + bound value.
fn seg_filter(seg: &PathSeg) -> (String, Option<Value>) {
    match seg.dim.as_str() {
        "folder" => (
            "m.folder_id = ?".into(),
            Some(Value::Integer(seg.key.parse().unwrap_or(-1))),
        ),
        "sender" => ("m.from_email = ?".into(), Some(Value::Text(seg.key.clone()))),
        "type" => ("m.type_cat = ?".into(), Some(Value::Text(seg.key.clone()))),
        "year" => {
            if seg.key == "unknown" {
                ("m.date IS NULL".into(), None)
            } else {
                (
                    "strftime('%Y', m.date, 'unixepoch') = ?".into(),
                    Some(Value::Text(seg.key.clone())),
                )
            }
        }
        _ => ("1=1".into(), None),
    }
}

/// Key + label SQL expressions for a grouping dimension.
fn dim_exprs(dim: &str) -> (&'static str, &'static str) {
    match dim {
        "folder" => ("CAST(m.folder_id AS TEXT)", "MAX(f.name)"),
        "sender" => (
            "m.from_email",
            "COALESCE(NULLIF(MAX(m.from_name),''), m.from_email)",
        ),
        "type" => ("m.type_cat", "m.type_cat"),
        "year" => (
            "COALESCE(strftime('%Y', m.date, 'unixepoch'), 'unknown')",
            "COALESCE(strftime('%Y', m.date, 'unixepoch'), 'unknown')",
        ),
        _ => ("''", "''"),
    }
}

fn build_where(account_id: i64, path: &[PathSeg]) -> (String, Vec<Value>) {
    let mut clauses = vec!["m.account_id = ?".to_string()];
    let mut vals = vec![Value::Integer(account_id)];
    for seg in path {
        let (c, v) = seg_filter(seg);
        clauses.push(c);
        if let Some(v) = v {
            vals.push(v);
        }
    }
    (clauses.join(" AND "), vals)
}

const FROM_BASE: &str = "FROM messages m JOIN folders f ON f.id = m.folder_id";

/// Children (+ one nested level) of the current drill position.
pub fn get_treemap(
    conn: &Connection,
    account_id: i64,
    group_by: &[String],
    path: &[PathSeg],
) -> rusqlite::Result<Vec<TreeNode>> {
    let (where_sql, vals) = build_where(account_id, path);
    let depth = path.len();

    if depth >= group_by.len() {
        // Message level: individual tiles.
        return message_nodes(conn, &where_sql, &vals, MSG_CAP);
    }

    let dim = &group_by[depth];
    let (kexpr, lexpr) = dim_exprs(dim);

    // Level-1 children.
    let sql = format!(
        "SELECT {kexpr} AS k, {lexpr} AS label, SUM(m.size) AS s, COUNT(*) AS c \
         {FROM_BASE} WHERE {where_sql} GROUP BY k ORDER BY s DESC LIMIT {CHILD_CAP}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut children: Vec<TreeNode> = stmt
        .query_map(params_from_iter(vals.iter()), |r| {
            Ok(TreeNode {
                key: r.get::<_, String>(0)?,
                label: r.get(1)?,
                sublabel: String::new(),
                size: r.get(2)?,
                count: r.get(3)?,
                cat: "mixed".into(),
                leaf: false,
                children: vec![],
            })
        })?
        .collect::<Result<_, _>>()?;

    // Remainder bucket so tile areas stay truthful.
    let (total_size, total_count): (i64, i64) = conn.query_row(
        &format!("SELECT COALESCE(SUM(m.size),0), COUNT(*) {FROM_BASE} WHERE {where_sql}"),
        params_from_iter(vals.iter()),
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let shown_size: i64 = children.iter().map(|c| c.size).sum();
    let shown_count: i64 = children.iter().map(|c| c.count).sum();
    if total_count > shown_count && total_size > shown_size {
        children.push(TreeNode {
            key: "__other__".into(),
            label: format!("{} more…", total_count - shown_count),
            sublabel: String::new(),
            size: total_size - shown_size,
            count: total_count - shown_count,
            cat: "other".into(),
            leaf: true,
            children: vec![],
        });
    }

    // Level-2: one window query for all children at once.
    let next_is_group = depth + 1 < group_by.len();
    if next_is_group {
        let dim2 = &group_by[depth + 1];
        let (k2, l2) = dim_exprs(dim2);
        let sql2 = format!(
            "SELECT k, k2, label, s, c FROM ( \
               SELECT {kexpr} AS k, {k2} AS k2, {l2} AS label, SUM(m.size) AS s, COUNT(*) AS c, \
                      ROW_NUMBER() OVER (PARTITION BY {kexpr} ORDER BY SUM(m.size) DESC) AS rn \
               {FROM_BASE} WHERE {where_sql} GROUP BY k, k2 \
             ) WHERE rn <= {GRANDCHILD_CAP}"
        );
        let mut stmt2 = conn.prepare(&sql2)?;
        let rows = stmt2.query_map(params_from_iter(vals.iter()), |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })?;
        attach_level2(&mut children, rows)?;
    } else {
        let sql2 = format!(
            "SELECT k, k2, label, s, c FROM ( \
               SELECT {kexpr} AS k, 'm:' || m.id AS k2, m.subject AS label, m.size AS s, 1 AS c, \
                      ROW_NUMBER() OVER (PARTITION BY {kexpr} ORDER BY m.size DESC) AS rn \
               {FROM_BASE} WHERE {where_sql} \
             ) WHERE rn <= {GRANDCHILD_CAP}"
        );
        let mut stmt2 = conn.prepare(&sql2)?;
        let rows = stmt2.query_map(params_from_iter(vals.iter()), |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })?;
        attach_level2(&mut children, rows)?;
    }

    Ok(children)
}

fn attach_level2(
    children: &mut [TreeNode],
    rows: impl Iterator<Item = rusqlite::Result<(String, String, String, i64, i64)>>,
) -> rusqlite::Result<()> {
    use std::collections::HashMap;
    let mut by_key: HashMap<String, Vec<TreeNode>> = HashMap::new();
    for row in rows {
        let (k, k2, label, s, c) = row?;
        by_key.entry(k).or_default().push(TreeNode {
            key: k2.clone(),
            label,
            sublabel: String::new(),
            size: s,
            count: c,
            cat: "mixed".into(),
            leaf: k2.starts_with("m:"),
            children: vec![],
        });
    }
    for child in children.iter_mut() {
        if let Some(mut kids) = by_key.remove(&child.key) {
            let shown: i64 = kids.iter().map(|k| k.size).sum();
            let shown_c: i64 = kids.iter().map(|k| k.count).sum();
            if child.count > shown_c && child.size > shown {
                kids.push(TreeNode {
                    key: "__other__".into(),
                    label: format!("{} more…", child.count - shown_c),
                    sublabel: String::new(),
                    size: child.size - shown,
                    count: child.count - shown_c,
                    cat: "other".into(),
                    leaf: true,
                    children: vec![],
                });
            }
            child.children = kids;
        }
    }
    Ok(())
}

fn message_nodes(
    conn: &Connection,
    where_sql: &str,
    vals: &[Value],
    cap: usize,
) -> rusqlite::Result<Vec<TreeNode>> {
    let sql = format!(
        "SELECT m.id, m.subject, COALESCE(NULLIF(m.from_name,''), m.from_email), m.size, m.type_cat \
         {FROM_BASE} WHERE {where_sql} ORDER BY m.size DESC LIMIT {cap}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut nodes: Vec<TreeNode> = stmt
        .query_map(params_from_iter(vals.iter()), |r| {
            Ok(TreeNode {
                key: format!("m:{}", r.get::<_, i64>(0)?),
                label: r.get::<_, String>(1)?,
                sublabel: r.get(2)?,
                size: r.get(3)?,
                count: 1,
                cat: r.get(4)?,
                leaf: true,
                children: vec![],
            })
        })?
        .collect::<Result<_, _>>()?;

    let (total_size, total_count): (i64, i64) = conn.query_row(
        &format!("SELECT COALESCE(SUM(m.size),0), COUNT(*) {FROM_BASE} WHERE {where_sql}"),
        params_from_iter(vals.iter()),
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let shown: i64 = nodes.iter().map(|n| n.size).sum();
    if total_count > nodes.len() as i64 && total_size > shown {
        nodes.push(TreeNode {
            key: "__other__".into(),
            label: format!("{} more…", total_count - nodes.len() as i64),
            sublabel: String::new(),
            size: total_size - shown,
            count: total_count - nodes.len() as i64,
            cat: "other".into(),
            leaf: true,
            children: vec![],
        });
    }
    Ok(nodes)
}

/// Message ids under a drill position (for bulk actions on a treemap node).
pub fn ids_for_path(
    conn: &Connection,
    account_id: i64,
    path: &[PathSeg],
) -> rusqlite::Result<Vec<i64>> {
    if let Some(last) = path.last() {
        if last.dim == "msg" {
            if let Some(id) = last.key.strip_prefix("m:") {
                return Ok(vec![id.parse().unwrap_or(-1)]);
            }
        }
    }
    let (where_sql, vals) = build_where(account_id, path);
    let sql = format!("SELECT m.id {FROM_BASE} WHERE {where_sql}");
    let mut stmt = conn.prepare(&sql)?;
    let ids = stmt
        .query_map(params_from_iter(vals.iter()), |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(ids)
}

pub fn top_senders(
    conn: &Connection,
    account_id: i64,
    limit: usize,
) -> rusqlite::Result<Vec<SenderStat>> {
    let mut stmt = conn.prepare(
        "SELECT from_email, COALESCE(NULLIF(MAX(from_name),''), from_email), COUNT(*), SUM(size), MAX(list_unsubscribe) \
         FROM messages WHERE account_id = ?1 GROUP BY from_email ORDER BY SUM(size) DESC LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![account_id, limit as i64], |r| {
            Ok(SenderStat {
                email: r.get(0)?,
                name: r.get(1)?,
                count: r.get(2)?,
                size: r.get(3)?,
                unsubscribe: r.get(4)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn unsubscribe_candidates(
    conn: &Connection,
    account_id: i64,
    limit: usize,
) -> rusqlite::Result<Vec<SenderStat>> {
    let mut stmt = conn.prepare(
        "SELECT from_email, COALESCE(NULLIF(MAX(from_name),''), from_email), COUNT(*), SUM(size), MAX(list_unsubscribe) \
         FROM messages WHERE account_id = ?1 AND list_unsubscribe IS NOT NULL \
         GROUP BY from_email ORDER BY COUNT(*) DESC LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![account_id, limit as i64], |r| {
            Ok(SenderStat {
                email: r.get(0)?,
                name: r.get(1)?,
                count: r.get(2)?,
                size: r.get(3)?,
                unsubscribe: r.get(4)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn largest_messages(
    conn: &Connection,
    account_id: i64,
    limit: usize,
) -> rusqlite::Result<Vec<MessageRow>> {
    let mut stmt = conn.prepare(
        "SELECT m.id, m.subject, m.from_email, m.from_name, f.name, m.date, m.size, m.type_cat \
         FROM messages m JOIN folders f ON f.id = m.folder_id \
         WHERE m.account_id = ?1 ORDER BY m.size DESC LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![account_id, limit as i64], |r| {
            Ok(MessageRow {
                id: r.get(0)?,
                subject: r.get(1)?,
                from_email: r.get(2)?,
                from_name: r.get(3)?,
                folder: r.get(4)?,
                date: r.get(5)?,
                size: r.get(6)?,
                cat: r.get(7)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn type_stats(conn: &Connection, account_id: i64) -> rusqlite::Result<Vec<TypeStat>> {
    let mut stmt = conn.prepare(
        "SELECT type_cat, COUNT(*), SUM(size) FROM messages WHERE account_id = ?1 \
         GROUP BY type_cat ORDER BY SUM(size) DESC",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![account_id], |r| {
            Ok(TypeStat {
                cat: r.get(0)?,
                count: r.get(1)?,
                size: r.get(2)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

fn message_rows(
    conn: &Connection,
    sql: &str,
    params: &[Value],
) -> rusqlite::Result<Vec<MessageRow>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(params_from_iter(params.iter()), |r| {
            Ok(MessageRow {
                id: r.get(0)?,
                subject: r.get(1)?,
                from_email: r.get(2)?,
                from_name: r.get(3)?,
                folder: r.get(4)?,
                date: r.get(5)?,
                size: r.get(6)?,
                cat: r.get(7)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

const MSG_ROW_COLS: &str = "m.id, m.subject, m.from_email, m.from_name, f.name, m.date, m.size, m.type_cat";

/// Everything the detail drawer needs for one message, including its
/// conversation (same normalized subject) and other mail from the sender.
pub fn message_detail(conn: &Connection, message_id: i64) -> rusqlite::Result<MessageDetail> {
    let (account_id, norm_subject, list_unsubscribe, row): (i64, String, Option<String>, MessageRow) =
        conn.query_row(
            &format!(
                "SELECT m.account_id, m.norm_subject, m.list_unsubscribe, {MSG_ROW_COLS} \
                 FROM messages m JOIN folders f ON f.id = m.folder_id WHERE m.id = ?1"
            ),
            rusqlite::params![message_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    MessageRow {
                        id: r.get(3)?,
                        subject: r.get(4)?,
                        from_email: r.get(5)?,
                        from_name: r.get(6)?,
                        folder: r.get(7)?,
                        date: r.get(8)?,
                        size: r.get(9)?,
                        cat: r.get(10)?,
                    },
                ))
            },
        )?;

    let mut stmt = conn.prepare(
        "SELECT filename, mime, ext, size FROM attachments WHERE message_id = ?1 ORDER BY size DESC",
    )?;
    let attachments = stmt
        .query_map(rusqlite::params![message_id], |r| {
            Ok(AttachmentInfo {
                filename: r.get(0)?,
                mime: r.get(1)?,
                ext: r.get(2)?,
                size: r.get(3)?,
            })
        })?
        .collect::<Result<_, _>>()?;

    let thread = if norm_subject.is_empty() {
        vec![]
    } else {
        // A window of the conversation centered on this message, so the
        // message itself is always present even in very long threads.
        let mut rows = message_rows(
            conn,
            &format!(
                "SELECT {MSG_ROW_COLS} FROM messages m JOIN folders f ON f.id = m.folder_id \
                 WHERE m.account_id = ? AND m.norm_subject = ? \
                 ORDER BY ABS(COALESCE(m.date, 0) - ?) ASC LIMIT 30"
            ),
            &[
                Value::Integer(account_id),
                Value::Text(norm_subject.clone()),
                Value::Integer(row.date.unwrap_or(0)),
            ],
        )?;
        rows.sort_by_key(|m| m.date.unwrap_or(0));
        rows
    };

    let from_sender = message_rows(
        conn,
        &format!(
            "SELECT {MSG_ROW_COLS} FROM messages m JOIN folders f ON f.id = m.folder_id \
             WHERE m.account_id = ? AND m.from_email = ? AND m.id != ? \
             ORDER BY m.size DESC LIMIT 15"
        ),
        &[
            Value::Integer(account_id),
            Value::Text(row.from_email.clone()),
            Value::Integer(message_id),
        ],
    )?;

    Ok(MessageDetail {
        id: row.id,
        subject: row.subject,
        from_email: row.from_email,
        from_name: row.from_name,
        folder: row.folder,
        date: row.date,
        size: row.size,
        cat: row.cat,
        list_unsubscribe,
        attachments,
        thread,
        from_sender,
    })
}

pub fn account_stats(conn: &Connection, account_id: i64) -> rusqlite::Result<AccountStats> {
    let (msg_count, total_size): (i64, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(size),0) FROM messages WHERE account_id = ?1",
        rusqlite::params![account_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let attach_size: i64 = conn.query_row(
        "SELECT COALESCE(SUM(a.size),0) FROM attachments a \
         JOIN messages m ON m.id = a.message_id WHERE m.account_id = ?1",
        rusqlite::params![account_id],
        |r| r.get(0),
    )?;
    let last_sync: Option<i64> = conn.query_row(
        "SELECT last_sync FROM accounts WHERE id = ?1",
        rusqlite::params![account_id],
        |r| r.get(0),
    )?;
    Ok(AccountStats {
        msg_count,
        total_size,
        attach_size,
        last_sync,
    })
}
