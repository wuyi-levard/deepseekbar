// src-tauri/src/scheduler.rs

use crate::deepseek::Balance;
use crate::error::{classify_error, AppError, ErrorKind};
use crate::state::AppState;
use tauri::Emitter;
use crate::store::{Snapshot, Store};
use std::sync::{Arc, Mutex};

pub const DEFAULT_INTERVAL_SECS: u64 = 300;

pub struct Scheduler {
    pub state: AppState,
    pub store: Arc<Store>,
    pub client: reqwest::Client,
    pub interval: std::time::Duration,
    pub app_handle: Option<tauri::AppHandle>,
    /// Timestamp (unix ms) of the last balance alert, used to throttle
    /// notifications so the user isn't spammed every refresh cycle.
    last_alert_ms: Mutex<i64>,
}

impl Scheduler {
    pub fn new(
        state: AppState,
        store: Arc<Store>,
        client: reqwest::Client,
        interval_secs: u64,
    ) -> Self {
        Scheduler {
            state,
            store,
            client,
            interval: std::time::Duration::from_secs(interval_secs),
            app_handle: None,
            last_alert_ms: Mutex::new(0),
        }
    }

    pub fn set_app_handle(&mut self, handle: tauri::AppHandle) {
        self.app_handle = Some(handle);
    }

    /// Execute a refresh cycle. Uses `tokio::sync::Mutex` (not `std::sync::Mutex`)
    /// because the guard is held across `.await` points (the HTTP fetch). This
    /// serializes all refresh attempts so only one API call is in-flight at a time.
    ///
    /// Emits `balance:updated` to the frontend on success, so both auto-refresh
    /// (background loop) and manual refresh (`trigger_refresh`) update the UI.
    pub async fn tick(&self) -> Result<(), AppError> {
        let _g = self.state.refresh_lock.lock().await;
        let key = match self.state.get_api_key().await {
            Some(k) => k,
            None => {
                let k = load_api_key_fallback(&self.store)
                    .ok_or_else(|| AppError::Keyring("No matching entry found".into()))?;
                self.state.set_api_key(k.clone()).await;
                k
            }
        };
        let balance = crate::deepseek::fetch_balance(&self.client, &key).await?;
        self.persist_and_cache(&balance).await?;
        self.check_balance_alert(&balance);

        // Emit event so the frontend updates the UI
        self.emit_balance_updated();

        Ok(())
    }

    /// Send the current cached balance to the frontend.
    fn emit_balance_updated(&self) {
        if let Some(ref handle) = self.app_handle {
            let state = self.state.clone();
            let handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(b) = state.get_balance().await {
                    let ts = state.last_refresh().await;
                    let _ = handle.emit("balance:updated", serde_json::json!({
                        "balance": &b,
                        "ts_utc": ts,
                    }));
                }
            });
        }
    }

    fn check_balance_alert(&self, balance: &Balance) {
        let threshold = match crate::store::get_alert_threshold(&self.store) {
            Some(t) => t,
            None => return,
        };
        if balance.available < threshold {
            // Throttle: only emit an alert once every 4 hours
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            {
                let mut last = self.last_alert_ms.lock().unwrap();
                if now - *last < 4 * 3600 * 1000 {
                    return;
                }
                *last = now;
            }
            tracing::info!(
                available = %balance.available,
                threshold = %threshold,
                "balance below alert threshold"
            );
            if let Some(ref handle) = self.app_handle {
                let msg = format!("余额 ¥{} 低于预警线 ¥{}", balance.available, threshold);
                let _ = handle.emit("balance:alert", serde_json::json!({ "message": msg, "available": balance.available.to_string(), "threshold": threshold.to_string() }));
            }
        }
    }

    pub async fn tick_with(&self, balance: Balance) -> Result<(), AppError> {
        let _g = self.state.refresh_lock.lock().await;
        self.persist_and_cache(&balance).await
    }
pub async fn tick_with_key(&self, key: &str) -> Result<(), AppError> {
        self.state.set_api_key(key.to_string()).await;
        let _g = self.state.refresh_lock.lock().await;
        let balance = crate::deepseek::fetch_balance(&self.client, key).await?;
        self.persist_and_cache(&balance).await?;
        self.emit_balance_updated();
        Ok(())
    }

    async fn persist_and_cache(&self, b: &Balance) -> Result<(), AppError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let last_ts = self.store.max_snapshot_ts()?.unwrap_or(0);
        if now < last_ts {
            tracing::warn!(now, last_ts, "skip snapshot: time regression");
        } else {
            self.store.write_snapshot(&Snapshot {
                ts_utc: now,
                balance: b.available,
                currency: b.currency.clone(),
                is_stale: false,
            })?;
        }
        self.state.set_balance(b.clone()).await;
        Ok(())
    }
}

pub fn kind(e: &AppError) -> ErrorKind {
    classify_error(e)
}

/// Fallback: try keyring with retries. Returns None if keyring is unavailable.
fn load_api_key_fallback(store: &Store) -> Option<String> {
    crate::store::load_api_key()
        .ok()
        .or_else(|| crate::store::load_api_key_sqlite(store).ok().flatten())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;
    use tempfile::tempdir;

    fn b() -> Balance {
        Balance {
            currency: "CNY".into(),
            total: Decimal::new(100, 2),
            granted: Decimal::new(0, 0),
            topped_up: Decimal::new(100, 2),
            available: Decimal::new(100, 2),
        }
    }

    #[tokio::test(start_paused = true)]
    async fn tick_with_writes_snapshot_on_success() {
        let dir = tempdir().unwrap();
        let store = Arc::new(Store::open(&dir.path().join("d.db")).unwrap());
        let s = AppState::new();
        let sched = Scheduler::new(s.clone(), store.clone(), reqwest::Client::new(), 300);
        sched.tick_with(b()).await.unwrap();
        assert_eq!(store.history(30).unwrap().len(), 1);
    }

    #[tokio::test]
    async fn tick_with_does_not_regress_when_history_has_newer_row() {
        let dir = tempdir().unwrap();
        let store = Arc::new(Store::open(&dir.path().join("d.db")).unwrap());
        store
            .write_snapshot(&Snapshot {
                ts_utc: i64::MAX / 2,
                balance: Decimal::new(1, 0),
                currency: "CNY".into(),
                is_stale: false,
            })
            .unwrap();
        let s = AppState::new();
        let sched = Scheduler::new(s.clone(), store.clone(), reqwest::Client::new(), 300);
        sched.tick_with(b()).await.unwrap();
        let h = store.history(30).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].ts_utc, i64::MAX / 2);
    }
}
