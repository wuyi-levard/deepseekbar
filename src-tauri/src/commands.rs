// src-tauri/src/commands.rs

use crate::deepseek::Balance;
use crate::error::{classify_error, AppError, ErrorKind};
use crate::scheduler::Scheduler;
use crate::state::AppState;
use crate::store::{self, Snapshot};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize)]
pub struct ApiKeyStatus {
    pub configured: bool,
}

#[derive(Serialize)]
pub struct WindowStateOut {
    pub position: Option<Position>,
    pub mode: String,
    pub pinned: bool,
}

#[derive(Deserialize)]
pub struct WindowStateIn {
    pub position: Option<Position>,
    pub mode: String,
    pub pinned: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

#[tauri::command]
pub fn get_api_key_status(
    scheduler: State<'_, Arc<Scheduler>>,
) -> ApiKeyStatus {
    ApiKeyStatus { configured: store::has_api_key_any(&scheduler.store) }
}

#[tauri::command]
pub fn get_api_key() -> Result<Option<String>, AppError> {
    Ok(store::load_api_key().ok())
}

#[tauri::command]
pub fn save_api_key(
    scheduler: State<'_, Arc<Scheduler>>,
    key: String,
) -> Result<(), AppError> {
    // Write SQLite first: if keyring fails later, the SQLite fallback
    // ensures the key is still retrievable on next load.
    store::save_api_key_sqlite(&scheduler.store, &key)?;
    if let Err(e) = store::save_api_key(&key) {
        tracing::warn!(error = %e, "keyring write failed, key saved to SQLite fallback only");
    }
    Ok(())
}

#[tauri::command]
pub async fn test_api_key(
    scheduler: State<'_, Arc<Scheduler>>,
    key: String,
) -> Result<String, AppError> {
    let balance = crate::deepseek::fetch_balance(&scheduler.client, &key).await?;
    Ok(balance.available.to_string())
}

#[tauri::command]
pub fn delete_api_key(
    scheduler: State<'_, Arc<Scheduler>>,
) -> Result<(), AppError> {
    let _ = store::delete_api_key_sqlite(&scheduler.store);
    store::delete_api_key()
}

#[tauri::command]
pub async fn get_current_balance(
    state: State<'_, AppState>,
) -> Result<Option<Balance>, AppError> {
    Ok(state.get_balance().await)
}

#[tauri::command]
pub fn trigger_refresh(
    app: AppHandle,
    state: State<'_, AppState>,
    scheduler: State<'_, Arc<Scheduler>>,
    key: Option<String>,
) -> Result<(), AppError> {
    let sched = scheduler.inner().clone();
    let state_clone = state.inner().clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = if let Some(k) = key {
            sched.tick_with_key(&k).await
        } else {
            sched.tick().await
        };
        if let Err(e) = result {
            emit_error(&app_clone, &state_clone, e);
        } else {
            emit_updated(&app_clone, &state_clone).await;
        }
    });
    Ok(())
}

#[tauri::command]
pub fn get_history(
    scheduler: State<'_, Arc<Scheduler>>,
    days: u32,
) -> Result<Vec<Snapshot>, AppError> {
    scheduler.store.history(days)
}

#[tauri::command]
pub fn get_window_state(
    scheduler: State<'_, Arc<Scheduler>>,
) -> Result<WindowStateOut, AppError> {
    let pos_str = scheduler.store.get_state("window_position")?;
    let mode = scheduler
        .store
        .get_state("window_mode")?
        .unwrap_or_else(|| "compact".to_string());
    let pinned_str = scheduler.store.get_state("pinned")?;
    let pinned = pinned_str.as_deref() == Some("true");
    let position = pos_str
        .and_then(|s| serde_json::from_str::<Position>(&s).ok());
    Ok(WindowStateOut { position, mode, pinned })
}

#[tauri::command]
pub fn save_window_state(
    scheduler: State<'_, Arc<Scheduler>>,
    state: WindowStateIn,
) -> Result<(), AppError> {
    if let Some(p) = state.position {
        scheduler
            .store
            .set_state("window_position", &serde_json::to_string(&p)?)?;
    }
    scheduler.store.set_state("window_mode", &state.mode)?;
    scheduler
        .store
        .set_state("pinned", if state.pinned { "true" } else { "false" })?;
    Ok(())
}


#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, AppError> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .is_enabled()
        .map_err(|e| AppError::Other(e.to_string()))
}
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), AppError> {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    if enabled {
        mgr.enable().map_err(|e| AppError::Other(e.to_string()))?;
    } else {
        mgr.disable().map_err(|e| AppError::Other(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_refresh_interval(
    scheduler: State<'_, Arc<Scheduler>>,
) -> u64 {
    store::get_interval(&scheduler.store)
}

#[tauri::command]
pub fn set_refresh_interval(
    scheduler: State<'_, Arc<Scheduler>>,
    secs: u64,
) -> Result<(), AppError> {
    store::set_interval(&scheduler.store, secs)?;
    // set_interval already calls backup() through set_state
    Ok(())
}

#[tauri::command]
pub fn get_alert_threshold(
    scheduler: State<'_, Arc<Scheduler>>,
) -> Result<Option<String>, AppError> {
    Ok(store::get_alert_threshold(&scheduler.store).map(|d| d.to_string()))
}

#[tauri::command]
pub fn set_alert_threshold(
    scheduler: State<'_, Arc<Scheduler>>,
    threshold: String,
) -> Result<(), AppError> {
    store::set_alert_threshold(&scheduler.store, &threshold)
}

#[tauri::command]
pub fn get_privacy_mode(
    scheduler: State<'_, Arc<Scheduler>>,
) -> bool {
    store::get_privacy_mode(&scheduler.store)
}

#[tauri::command]
pub fn set_privacy_mode(
    scheduler: State<'_, Arc<Scheduler>>,
    enabled: bool,
) -> Result<(), AppError> {
    store::set_privacy_mode(&scheduler.store, enabled)
}

#[tauri::command]
pub fn get_theme(
    scheduler: State<'_, Arc<Scheduler>>,
) -> String {
    store::get_theme(&scheduler.store)
}

#[tauri::command]
pub fn set_theme(
    scheduler: State<'_, Arc<Scheduler>>,
    theme: String,
) -> Result<(), AppError> {
    store::set_theme(&scheduler.store, &theme)
}

pub async fn emit_updated(app: &AppHandle, state: &AppState) {
    if let Some(b) = state.get_balance().await {
        let ts = state.last_refresh().await;
        let _ = app.emit("balance:updated", &serde_json::json!({
            "balance": &b,
            "ts_utc": ts,
        }));
    }
}

pub fn emit_error(app: &AppHandle, _state: &AppState, err: AppError) {
    let kind = classify_error(&err);
    let kind_str = match kind {
        ErrorKind::Auth => "auth",
        ErrorKind::Network => "network",
        ErrorKind::Parse => "parse",
        ErrorKind::Internal => "internal",
    };
    let _ = app.emit(
        "balance:error",
        &serde_json::json!({ "kind": kind_str, "message": err.to_string() }),
    );
}

#[tauri::command]
pub fn reset_data(
    scheduler: State<'_, Arc<Scheduler>>,
) -> Result<(), AppError> {
    scheduler.store.cleanup_older_than(i64::MAX)?;
    let _ = store::delete_api_key();
    Ok(())
}
