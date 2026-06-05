// src-tauri/src/state.rs

use crate::deepseek::Balance;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Default)]
pub struct Cache {
    pub last_balance: Option<Balance>,
    pub last_refresh_unix_ms: i64,
    pub api_key: Option<String>,
}

#[derive(Clone)]
pub struct AppState {
    pub cache: Arc<RwLock<Cache>>,
    pub refresh_lock: Arc<tokio::sync::Mutex<()>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            cache: Arc::new(RwLock::new(Cache::default())),
            refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    pub async fn set_balance(&self, b: Balance) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let mut g = self.cache.write().await;
        g.last_balance = Some(b);
        g.last_refresh_unix_ms = now;
    }

    pub async fn get_balance(&self) -> Option<Balance> {
        self.cache.read().await.last_balance.clone()
    }

    pub async fn last_refresh(&self) -> i64 {
        self.cache.read().await.last_refresh_unix_ms
    }
    pub async fn set_api_key(&self, key: String) {
        let mut g = self.cache.write().await;
        g.api_key = Some(key);
    }

    pub async fn get_api_key(&self) -> Option<String> {
        self.cache.read().await.api_key.clone()
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;

    fn b() -> Balance {
        Balance {
            currency: "CNY".into(),
            total: Decimal::new(100, 2),
            granted: Decimal::new(0, 0),
            topped_up: Decimal::new(100, 2),
            available: Decimal::new(100, 2),
        }
    }

    #[tokio::test]
    async fn new_starts_empty() {
        let s = AppState::new();
        assert!(s.get_balance().await.is_none());
    }

    #[tokio::test]
    async fn set_then_get_returns_same() {
        let s = AppState::new();
        s.set_balance(b()).await;
        let got = s.get_balance().await.unwrap();
        assert_eq!(got.available, Decimal::new(100, 2));
    }
}
