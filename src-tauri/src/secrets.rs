//! App passwords live in the OS keychain, never in SQLite.

const SERVICE: &str = "com.mailstat.app";

fn entry(account_id: i64) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &format!("account-{account_id}")).map_err(|e| e.to_string())
}

pub fn store_password(account_id: i64, password: &str) -> Result<(), String> {
    entry(account_id)?
        .set_password(password)
        .map_err(|e| e.to_string())
}

pub fn get_password(account_id: i64) -> Result<String, String> {
    entry(account_id)?.get_password().map_err(|e| e.to_string())
}

pub fn delete_password(account_id: i64) {
    if let Ok(e) = entry(account_id) {
        let _ = e.delete_credential();
    }
}
