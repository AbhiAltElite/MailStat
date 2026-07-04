use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct Account {
    pub id: i64,
    pub kind: String,
    pub email: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub last_sync: Option<i64>,
    pub msg_count: i64,
    pub total_size: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewAccount {
    pub email: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderInfo {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub special: Option<String>,
    pub msg_count: i64,
    pub total_size: i64,
}

/// One step of the drill-down path, e.g. {dim:"folder", key:"12", label:"INBOX"}.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathSeg {
    pub dim: String,
    pub key: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TreeNode {
    pub key: String,
    pub label: String,
    pub sublabel: String,
    pub size: i64,
    pub count: i64,
    pub cat: String,
    pub leaf: bool,
    pub children: Vec<TreeNode>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SenderStat {
    pub email: String,
    pub name: String,
    pub count: i64,
    pub size: i64,
    pub unsubscribe: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageRow {
    pub id: i64,
    pub subject: String,
    pub from_email: String,
    pub from_name: String,
    pub folder: String,
    pub date: Option<i64>,
    pub size: i64,
    pub cat: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AttachmentInfo {
    pub filename: String,
    pub mime: String,
    pub ext: String,
    pub size: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageDetail {
    pub id: i64,
    pub subject: String,
    pub from_email: String,
    pub from_name: String,
    pub folder: String,
    pub date: Option<i64>,
    pub size: i64,
    pub cat: String,
    pub list_unsubscribe: Option<String>,
    pub attachments: Vec<AttachmentInfo>,
    /// Messages sharing the same normalized subject (the conversation).
    pub thread: Vec<MessageRow>,
    /// Other recent messages from the same sender.
    pub from_sender: Vec<MessageRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TypeStat {
    pub cat: String,
    pub count: i64,
    pub size: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountStats {
    pub msg_count: i64,
    pub total_size: i64,
    pub attach_size: i64,
    pub last_sync: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanProgress {
    pub account_id: i64,
    pub folder: String,
    pub folder_index: usize,
    pub folder_count: usize,
    pub done_in_folder: u32,
    pub total_in_folder: u32,
    pub messages_total: u64,
    pub bytes_total: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ActionResult {
    pub affected: i64,
    pub bytes: i64,
}
