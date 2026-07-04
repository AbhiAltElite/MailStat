//! Synthetic mailbox so the UI can be explored without connecting an account.

use crate::mailmeta::categorize;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use rusqlite::{params, Connection};

struct Sender {
    email: &'static str,
    name: &'static str,
    newsletter: bool,
    volume: u32,
    avg_kb: f64,
    attach_bias: f64, // 0..1 chance a message carries an attachment
}

const SENDERS: &[Sender] = &[
    Sender { email: "newsletter@techdigest.io", name: "Tech Digest", newsletter: true, volume: 640, avg_kb: 95.0, attach_bias: 0.02 },
    Sender { email: "deals@shopmart.com", name: "ShopMart Deals", newsletter: true, volume: 580, avg_kb: 210.0, attach_bias: 0.01 },
    Sender { email: "no-reply@linkedpro.com", name: "LinkedPro", newsletter: true, volume: 470, avg_kb: 60.0, attach_bias: 0.0 },
    Sender { email: "updates@newsroom.co", name: "The Newsroom", newsletter: true, volume: 390, avg_kb: 130.0, attach_bias: 0.0 },
    Sender { email: "hello@designweekly.dev", name: "Design Weekly", newsletter: true, volume: 210, avg_kb: 340.0, attach_bias: 0.05 },
    Sender { email: "team@cloudphotos.app", name: "CloudPhotos", newsletter: false, volume: 85, avg_kb: 2600.0, attach_bias: 0.9 },
    Sender { email: "sarah.chen@acmecorp.com", name: "Sarah Chen", newsletter: false, volume: 320, avg_kb: 450.0, attach_bias: 0.35 },
    Sender { email: "raj.patel@acmecorp.com", name: "Raj Patel", newsletter: false, volume: 260, avg_kb: 380.0, attach_bias: 0.3 },
    Sender { email: "mom.family@gmail.com", name: "Mom", newsletter: false, volume: 150, avg_kb: 1800.0, attach_bias: 0.6 },
    Sender { email: "invoices@utilityco.ae", name: "UtilityCo Billing", newsletter: false, volume: 96, avg_kb: 240.0, attach_bias: 0.95 },
    Sender { email: "receipts@rideshare.com", name: "RideShare Receipts", newsletter: true, volume: 310, avg_kb: 45.0, attach_bias: 0.1 },
    Sender { email: "noreply@bankmail.ae", name: "BankMail Statements", newsletter: false, volume: 72, avg_kb: 520.0, attach_bias: 0.9 },
    Sender { email: "video-share@bigfiles.net", name: "BigFiles Transfer", newsletter: false, volume: 18, avg_kb: 14000.0, attach_bias: 1.0 },
    Sender { email: "alerts@statuspage.dev", name: "StatusPage Alerts", newsletter: true, volume: 420, avg_kb: 22.0, attach_bias: 0.0 },
    Sender { email: "james.w@freelancehub.com", name: "James Whitfield", newsletter: false, volume: 88, avg_kb: 900.0, attach_bias: 0.5 },
];

const SUBJECTS: &[&str] = &[
    "Weekly roundup", "Your invoice is ready", "Re: project timeline", "Photos from the weekend",
    "Action required: verify your account", "Q3 report draft", "Meeting notes", "Your receipt",
    "New sign-in detected", "Holiday plans", "Contract for review", "Design feedback",
    "Statement available", "Re: budget approval", "Team offsite details", "Your order shipped",
];

const ATTACH_KINDS: &[(&str, &str, f64)] = &[
    ("pdf", "application/pdf", 320.0),
    ("jpg", "image/jpeg", 1400.0),
    ("png", "image/png", 800.0),
    ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 260.0),
    ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 180.0),
    ("zip", "application/zip", 4200.0),
    ("mp4", "video/mp4", 16000.0),
    ("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", 2400.0),
];

pub fn seed(conn: &mut Connection) -> Result<i64, String> {
    // Idempotent: reuse the existing demo mailbox rather than piling up a new
    // one every time "Try with demo data" is clicked.
    if let Ok(existing) = conn.query_row(
        "SELECT id FROM accounts WHERE kind = 'demo' LIMIT 1",
        [],
        |r| r.get::<_, i64>(0),
    ) {
        return Ok(existing);
    }

    let mut rng = StdRng::seed_from_u64(42);
    let now: i64 = 1_751_600_000; // fixed "now" so the demo is deterministic
    let four_years: i64 = 4 * 365 * 24 * 3600;

    conn.execute(
        "INSERT INTO accounts (kind, email, label, created_at) VALUES ('demo','demo@mailstat.app','Demo mailbox', strftime('%s','now'))",
        [],
    )
    .map_err(|e| e.to_string())?;
    let account_id = conn.last_insert_rowid();

    let folder_defs: &[(&str, Option<&str>)] = &[
        ("INBOX", None),
        ("Newsletters", None),
        ("Work", None),
        ("Personal", None),
        ("Receipts", None),
        ("Sent", Some("sent")),
        ("Archive", Some("archive")),
        ("Trash", Some("trash")),
    ];
    let mut folder_ids = vec![];
    for (name, special) in folder_defs {
        conn.execute(
            "INSERT INTO folders (account_id, path, name, special) VALUES (?1,?2,?2,?3)",
            params![account_id, name, special],
        )
        .map_err(|e| e.to_string())?;
        folder_ids.push((conn.last_insert_rowid(), *name));
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut ins_msg = tx
            .prepare(
                "INSERT INTO messages (account_id, folder_id, uid, subject, from_email, from_name, date, size, has_attachments, type_cat, list_unsubscribe, norm_subject) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            )
            .map_err(|e| e.to_string())?;
        let mut ins_att = tx
            .prepare("INSERT INTO attachments (message_id, filename, mime, ext, size) VALUES (?1,?2,?3,?4,?5)")
            .map_err(|e| e.to_string())?;

        let mut uid: i64 = 1;
        for s in SENDERS {
            for _ in 0..s.volume {
                uid += 1;
                let folder = if s.newsletter {
                    if rng.gen_bool(0.7) { 1 } else { 0 }
                } else if s.email.contains("acmecorp") {
                    2
                } else if s.email.contains("invoices") || s.email.contains("receipts") || s.email.contains("bankmail") {
                    4
                } else if rng.gen_bool(0.5) {
                    0
                } else {
                    3
                };
                let (folder_id, _) = folder_ids[folder];
                let date = now - rng.gen_range(0..four_years);
                let base = (s.avg_kb * 1024.0 * rng.gen_range(0.3..2.2)) as i64;

                let with_attach = rng.gen_bool(s.attach_bias);
                let (mut size, mut cat) = (base, "plain");
                let mut atts: Vec<(String, String, String, i64)> = vec![];
                if with_attach {
                    let n = if rng.gen_bool(0.2) { 2 } else { 1 };
                    for _ in 0..n {
                        let (ext, mime, avg) = ATTACH_KINDS[rng.gen_range(0..ATTACH_KINDS.len())];
                        let asize = (avg * 1024.0 * rng.gen_range(0.2..3.0)) as i64;
                        size += asize;
                        atts.push((format!("file-{uid}.{ext}"), mime.to_string(), ext.to_string(), asize));
                    }
                    if let Some(largest) = atts.iter().max_by_key(|a| a.3) {
                        cat = categorize(&largest.2, &largest.1);
                    }
                }

                let subject = SUBJECTS[rng.gen_range(0..SUBJECTS.len())];
                let unsub = if s.newsletter {
                    Some(format!("<https://unsubscribe.example.com/{}>", s.email))
                } else {
                    None
                };
                ins_msg
                    .execute(params![
                        account_id, folder_id, uid, subject, s.email, s.name, date, size,
                        !atts.is_empty(), cat, unsub,
                        crate::mailmeta::normalize_subject(subject)
                    ])
                    .map_err(|e| e.to_string())?;
                let mid = tx.last_insert_rowid();
                for (fname, mime, ext, asize) in &atts {
                    ins_att
                        .execute(params![mid, fname, mime, ext, asize])
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    crate::db::refresh_folder_totals(conn, account_id).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE accounts SET last_sync=strftime('%s','now') WHERE id=?1",
        params![account_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(account_id)
}
