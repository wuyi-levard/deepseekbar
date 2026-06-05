// src-tauri/src/scheduler.rs

use crate::deepseek::Balance;
use crate::error::{classify_error, AppError, ErrorKind};
use crate::state::AppState;
use crate::store::{Snapshot, Store};
use std::sync::Arc;

pub const DEFAULT_INTERVAL_SECS: u64 = 300;

pub struct Scheduler {
    pub state: AppState,
    pub store: Arc<Store>,
    pub client: reqwest::Client,
    pub interval: std::time::Duration,
}

impl Scheduler {
    pub fn new(
        state: AppState,
        store: Arc<Store>,
        client: reqwest::Client,
    ) -> Self {
        Scheduler {
            state,
            store,
            client,
            interval: std::time::Duration::from_secs(DEFAULT_INTERVAL_SECS),
        }
    }

    pub async fn tick(&self) -> Result<(), AppError> {
        let _g = self.state.refresh_lock.lock().await;
        let key = crate::store::load_api_key()?;
        let balance = crate::deepseek::fetch_balance(&self.client, &key).await?;
        self.persist_and_cache(&balance).await?;
        Ok(())
    }

    pub async fn tick_with(&self, balance: Balance) -> Result<(), AppError> {
        let _g = self.state.refresh_lock.lock().await;
        self.persist_and_cache(&balance).await
    }

    async fn persist_and_cache(&self, b: &Balance) -> Result<(), AppError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let last_ts = self
            .store
            .history(30)?
            .into_iter()
            .map(|s| s.ts_utc)
            .max()
            .unwrap_or(0);
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

    pub fn spawn(self) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            loop {
                if crate::store::has_api_key() {
                    if let Err(e) = self.tick().await {
                        tracing::warn!(error = %e, "scheduled tick failed");
                    }
                }
                tokio::time::sleep(self.interval).await;
            }
        })
    }
}

pub fn kind(e: &AppError) -> ErrorKind {
    classify_error(e)
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
        let sched = Scheduler::new(s.clone(), store.clone(), reqwest::Client::new());
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
        let sched = Scheduler::new(s.clone(), store.clone(), reqwest::Client::new());
        sched.tick_with(b()).await.unwrap();
        let h = store.history(30).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].ts_utc, i64::MAX / 2);
    }
}
