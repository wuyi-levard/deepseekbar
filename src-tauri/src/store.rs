// src-tauri/src/store.rs

use crate::error::AppError;
use rusqlite::types::Type;
use rusqlite::{params, Connection, OptionalExtension};
use rust_decimal::Decimal;
use serde::Serialize;
use std::sync::Mutex;

const KEYRING_SERVICE: &str = "com.deepseekbar.app";
const KEYRING_USER: &str = "api_key";

#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub ts_utc: i64,
    pub balance: Decimal,
    pub currency: String,
    pub is_stale: bool,
}

pub struct Store {
    conn: Mutex<Connection>,
    path: std::path::PathBuf,
}
impl Store {
    pub fn open(path: &std::path::Path) -> Result<Self, AppError> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS snapshots (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                ts_utc    INTEGER NOT NULL,
                balance   TEXT    NOT NULL,
                currency  TEXT    NOT NULL DEFAULT 'CNY',
                is_stale  INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON snapshots(ts_utc);
            CREATE TABLE IF NOT EXISTS app_state (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )?;
        Ok(Store { conn: Mutex::new(conn), path: path.to_path_buf() })
    }

    pub fn write_snapshot(&self, snap: &Snapshot) -> Result<(), AppError> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO snapshots (ts_utc, balance, currency, is_stale) VALUES (?, ?, ?, ?)",
            params![
                snap.ts_utc,
                snap.balance.to_string(),
                snap.currency,
                snap.is_stale as i64,
            ],
        )?;
        Ok(())
    }

    pub fn history(&self, days: u32) -> Result<Vec<Snapshot>, AppError> {
        let cutoff = chrono_now_minus_days(days);
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT ts_utc, balance, currency, is_stale FROM snapshots \
             WHERE ts_utc >= ? ORDER BY ts_utc ASC",
        )?;
        let rows = stmt
            .query_map(params![cutoff], |r| {
                let ts: i64 = r.get(0)?;
                let bal: String = r.get(1)?;
                let cur: String = r.get(2)?;
                let stale: i64 = r.get(3)?;
                Ok(Snapshot {
                    ts_utc: ts,
                    balance: Decimal::from_str_exact(&bal)
                        .map_err(|e| rusqlite::Error::InvalidColumnType(0, e.to_string(), Type::Text))?,
                    currency: cur,
                    is_stale: stale != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn cleanup_older_than(&self, cutoff_utc_ms: i64) -> Result<usize, AppError> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let n = conn.execute(
            "DELETE FROM snapshots WHERE ts_utc < ?",
            params![cutoff_utc_ms],
        )?;
        Ok(n)
    }


    /// Return the maximum snapshot ts_utc, or None when the table is empty.
    pub fn max_snapshot_ts(&self) -> Result<Option<i64>, AppError> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let v = conn.query_row(
            "SELECT MAX(ts_utc) FROM snapshots",
            [],
            |r| r.get::<_, Option<i64>>(0),
        )?;
        Ok(v)
    }
    pub fn set_state(&self, key: &str, value: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO app_state (key, value) VALUES (?, ?) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        self.backup();
        Ok(())
    }

    fn backup(&self) {
        let _ = std::fs::copy(&self.path, backup_path_for(&self.path));
    }

    pub fn get_state(&self, key: &str) -> Result<Option<String>, AppError> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let v = conn
            .query_row(
                "SELECT value FROM app_state WHERE key = ?",
                params![key],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        Ok(v)
    }
}


fn backup_path_for(db_path: &std::path::Path) -> std::path::PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| db_path.parent().unwrap_or(std::path::Path::new(".")).to_path_buf())
        .join("deepseekbar")
        .join("data.db")
}

/// Backup database to LOCALAPPDATA so data survives NSIS uninstall/reinstall
pub fn backup_db(db_path: &std::path::Path) {
    let backup_path = backup_path_for(db_path);
    let _ = std::fs::create_dir_all(backup_path.parent().unwrap());
    let _ = std::fs::copy(db_path, &backup_path);
}
pub const DEFAULT_INTERVAL_SECS: u64 = 300;

pub fn get_interval(store: &Store) -> u64 {
    store.get_state("refresh_interval_secs")
        .ok()
        .flatten()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_INTERVAL_SECS)
}

pub fn set_interval(store: &Store, secs: u64) -> Result<(), AppError> {
    store.set_state("refresh_interval_secs", &secs.to_string())
}

fn chrono_now_minus_days(days: u32) -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    now - (days as i64) * 86_400_000
}

pub fn save_api_key(key: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)?;
    entry.set_password(key)?;
    Ok(())
}

/// SQLite-backed API key (survives keyring glitches)
pub fn save_api_key_sqlite(store: &Store, key: &str) -> Result<(), AppError> {
    store.set_state("api_key", key)
}
pub fn load_api_key_sqlite(store: &Store) -> Result<Option<String>, AppError> {
    store.get_state("api_key")
}
pub fn delete_api_key_sqlite(store: &Store) -> Result<(), AppError> {
    store.set_state("api_key", "")
}

pub fn load_api_key() -> Result<String, AppError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)?;
    let p = entry.get_password()?;
    Ok(p)
}

pub fn delete_api_key() -> Result<(), AppError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn has_api_key() -> bool {
    load_api_key().is_ok()
}

pub fn has_api_key_any(store: &Store) -> bool {
    load_api_key().is_ok() || load_api_key_sqlite(store).ok().flatten().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn now_ms() -> i64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    #[test]
    fn store_creates_schema_on_open() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("data.db");
        let _ = Store::open(&path).unwrap();
        let s2 = Store::open(&path).unwrap();
        assert!(s2.history(30).unwrap().is_empty());
    }

    #[test]
    fn write_snapshot_then_read_back() {
        let dir = tempdir().unwrap();
        let s = Store::open(&dir.path().join("d.db")).unwrap();
        let snap = Snapshot {
            ts_utc: now_ms(),
            balance: Decimal::new(1234, 2),
            currency: "CNY".into(),
            is_stale: false,
        };
        s.write_snapshot(&snap).unwrap();
        let h = s.history(30).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].balance, Decimal::new(1234, 2));
        assert_eq!(h[0].currency, "CNY");
        assert!(!h[0].is_stale);
    }

    #[test]
    fn write_two_ordered_returns_ascending() {
        let dir = tempdir().unwrap();
        let s = Store::open(&dir.path().join("d.db")).unwrap();
        let base = now_ms();
        s.write_snapshot(&Snapshot {
            ts_utc: base + 20,
            balance: Decimal::new(2, 0),
            currency: "CNY".into(),
            is_stale: false,
        })
        .unwrap();
        s.write_snapshot(&Snapshot {
            ts_utc: base + 10,
            balance: Decimal::new(1, 0),
            currency: "CNY".into(),
            is_stale: false,
        })
        .unwrap();
        let h = s.history(30).unwrap();
        assert_eq!(h[0].ts_utc, base + 10);
        assert_eq!(h[1].ts_utc, base + 20);
    }

    #[test]
    fn cleanup_removes_old_rows() {
        let dir = tempdir().unwrap();
        let s = Store::open(&dir.path().join("d.db")).unwrap();
        let base = now_ms();
        s.write_snapshot(&Snapshot {
            ts_utc: base - 100,
            balance: Decimal::new(1, 0),
            currency: "CNY".into(),
            is_stale: false,
        })
        .unwrap();
        s.write_snapshot(&Snapshot {
            ts_utc: base,
            balance: Decimal::new(100, 0),
            currency: "CNY".into(),
            is_stale: false,
        })
        .unwrap();
        let n = s.cleanup_older_than(base - 50).unwrap();
        assert_eq!(n, 1);
        let h = s.history(30).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].ts_utc, base);
    }

    #[test]
    fn app_state_set_get_overwrite() {
        let dir = tempdir().unwrap();
        let s = Store::open(&dir.path().join("d.db")).unwrap();
        assert!(s.get_state("mode").unwrap().is_none());
        s.set_state("mode", "compact").unwrap();
        assert_eq!(s.get_state("mode").unwrap().as_deref(), Some("compact"));
        s.set_state("mode", "expanded").unwrap();
        assert_eq!(s.get_state("mode").unwrap().as_deref(), Some("expanded"));
    }
}
