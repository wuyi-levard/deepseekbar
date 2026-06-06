pub mod commands;
pub mod deepseek;
pub mod error;
pub mod scheduler;
pub mod state;
pub mod store;
pub mod tray;

use crate::scheduler::Scheduler;
use crate::state::AppState;
use crate::store::Store;
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let log_dir = app
                .path()
                .app_log_dir()
                .unwrap_or_else(|_| std::env::temp_dir());
            let _ = std::fs::create_dir_all(&log_dir);
            let file_appender = tracing_appender::rolling::daily(&log_dir, "deepseekbar.log");
            let (nb, _guard) = tracing_appender::non_blocking(file_appender);
            let subscriber = tracing_subscriber::fmt()
                .with_writer(nb)
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn,deepseekbar=info")),
                )
                .with_ansi(false)
                .finish();
            let _ = tracing::subscriber::set_global_default(subscriber);

            let data_dir = app.path().app_data_dir().expect("no data dir");
            let _ = std::fs::create_dir_all(&data_dir);
            let db_path = data_dir.join("data.db");

            let store = Arc::new(Store::open(&db_path).expect("open store"));
            let cutoff = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0)
                - 30 * 86_400_000;
            let _ = store.cleanup_older_than(cutoff);

            // Backup database to LOCALAPPDATA to survive NSIS uninstall
            let backup_dir = dirs::data_local_dir()
                .unwrap_or_else(|| data_dir.clone())
                .join("deepseekbar");
            let _ = std::fs::create_dir_all(&backup_dir);
            let backup_path = backup_dir.join("data.db");
            if db_path.exists() {
                let _ = std::fs::copy(&db_path, &backup_path);
            } else if backup_path.exists() {
                let _ = std::fs::copy(&backup_path, &db_path);
                tracing::info!("restored data from backup after upgrade");
            }

            let state = AppState::new();
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .connect_timeout(std::time::Duration::from_secs(5))
                .build()
                .expect("build client");

            let interval_secs = store::get_interval(&store);
            let mut sched = Scheduler::new(state.clone(), store.clone(), client, interval_secs);
            sched.set_app_handle(app.handle().clone());
            let sched = Arc::new(sched);

            // Seed in-memory API key cache from keyring (or SQLite fallback) at startup
            let seed_key = store::load_api_key()
                .ok()
                .or_else(|| store::load_api_key_sqlite(&store).ok().flatten());
            if let Some(k) = seed_key {
                tauri::async_runtime::block_on(state.set_api_key(k));
            }

            let sched_for_loop = sched.clone();
            let store_for_loop = store.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    if store::has_api_key_any(&store_for_loop) {
                        if let Err(e) = sched_for_loop.tick().await {
                            tracing::warn!(error = %e, "scheduled tick failed");
                        }
                    }
                    let interval = store::get_interval(&store_for_loop);
                    tokio::time::sleep(std::time::Duration::from_secs(interval)).await;
                }
            });

            app.manage(state);
            app.manage(sched);

            let handle = app.handle().clone();
            tray::build(&handle).expect("build tray");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_api_key_status,
            commands::get_api_key,
            commands::save_api_key,
            commands::test_api_key,
            commands::delete_api_key,
            commands::get_current_balance,
            commands::trigger_refresh,
            commands::get_history,
            commands::get_window_state,
            commands::save_window_state,
            commands::get_autostart,
            commands::set_autostart,
            commands::reset_data,
            commands::get_alert_threshold,
            commands::set_alert_threshold,
            commands::get_privacy_mode,
            commands::set_privacy_mode,
            commands::get_theme,
            commands::set_theme,
            commands::get_refresh_interval,
            commands::set_refresh_interval,
            commands::save_file,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
