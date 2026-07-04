//! End-to-end test of the local data path: seed demo mailbox → SQLite →
//! treemap aggregation → cleanup action, without any IMAP server.

use mailstat_lib::{actions, db, demo, models::PathSeg, queries};

fn setup() -> (rusqlite::Connection, i64) {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    db::init(&conn).unwrap();
    let account_id = demo::seed(&mut conn).unwrap();
    (conn, account_id)
}

#[test]
fn demo_seed_and_stats() {
    let (conn, account_id) = setup();
    let stats = queries::account_stats(&conn, account_id).unwrap();
    assert_eq!(stats.msg_count, 4109); // sum of demo sender volumes
    assert!(stats.total_size > 1_000_000_000, "demo mailbox should be GB-scale");
    assert!(stats.attach_size > 0);
}

#[test]
fn treemap_levels_are_truthful() {
    let (conn, account_id) = setup();
    let group_by = vec!["folder".to_string(), "sender".to_string()];

    // Level 0: folders. Sizes must sum to the account total.
    let nodes = queries::get_treemap(&conn, account_id, &group_by, &[]).unwrap();
    assert!(!nodes.is_empty());
    let stats = queries::account_stats(&conn, account_id).unwrap();
    let sum: i64 = nodes.iter().map(|n| n.size).sum();
    assert_eq!(sum, stats.total_size);

    // Each group's nested children (incl. "more…" bucket) sum to the group size.
    for n in nodes.iter().filter(|n| !n.children.is_empty()) {
        let child_sum: i64 = n.children.iter().map(|c| c.size).sum();
        assert_eq!(child_sum, n.size, "children of {} must sum to parent", n.label);
    }

    // Drill into the largest folder → sender level.
    let top = &nodes[0];
    let path = vec![PathSeg { dim: "folder".into(), key: top.key.clone() }];
    let senders = queries::get_treemap(&conn, account_id, &group_by, &path).unwrap();
    let sender_sum: i64 = senders.iter().map(|n| n.size).sum();
    assert_eq!(sender_sum, top.size);

    // Drill to message level.
    let mut path2 = path.clone();
    path2.push(PathSeg { dim: "sender".into(), key: senders[0].key.clone() });
    let msgs = queries::get_treemap(&conn, account_id, &group_by, &path2).unwrap();
    assert!(msgs.iter().all(|m| m.leaf));
    let msg_sum: i64 = msgs.iter().map(|m| m.size).sum();
    assert_eq!(msg_sum, senders[0].size);
}

#[test]
fn top_lists_and_unsubscribe() {
    let (conn, account_id) = setup();
    let senders = queries::top_senders(&conn, account_id, 10).unwrap();
    assert_eq!(senders.len(), 10);
    assert!(senders[0].size >= senders[9].size);

    let unsub = queries::unsubscribe_candidates(&conn, account_id, 50).unwrap();
    assert!(!unsub.is_empty());
    assert!(unsub.iter().all(|s| s.unsubscribe.is_some()));

    let largest = queries::largest_messages(&conn, account_id, 5).unwrap();
    assert_eq!(largest.len(), 5);
    assert!(largest[0].size >= largest[4].size);
}

#[test]
fn message_detail_with_connections() {
    let (conn, account_id) = setup();
    let largest = queries::largest_messages(&conn, account_id, 1).unwrap().remove(0);
    let detail = queries::message_detail(&conn, largest.id).unwrap();
    assert_eq!(detail.id, largest.id);
    assert_eq!(detail.size, largest.size);
    assert!(!detail.attachments.is_empty(), "largest demo message should carry attachments");
    assert!(detail.thread.iter().any(|m| m.id == largest.id), "thread includes the message itself");
    assert!(!detail.from_sender.is_empty());
    assert!(detail.from_sender.iter().all(|m| m.id != largest.id));
    assert!(detail.from_sender.iter().all(|m| m.from_email == detail.from_email));
}

#[test]
fn cleanup_action_on_demo_account() {
    let (mut conn, account_id) = setup();
    let before = queries::account_stats(&conn, account_id).unwrap();

    // Trash everything from the heaviest sender.
    let top = queries::top_senders(&conn, account_id, 1).unwrap().remove(0);
    let path = vec![PathSeg { dim: "sender".into(), key: top.email.clone() }];
    let ids = queries::ids_for_path(&conn, account_id, &path).unwrap();
    assert_eq!(ids.len() as i64, top.count);

    let res = actions::perform(&mut conn, account_id, None, &ids, actions::MailAction::Trash).unwrap();
    assert_eq!(res.affected, top.count);
    assert_eq!(res.bytes, top.size);

    let after = queries::account_stats(&conn, account_id).unwrap();
    assert_eq!(after.msg_count, before.msg_count - top.count);
    assert_eq!(after.total_size, before.total_size - top.size);
}
