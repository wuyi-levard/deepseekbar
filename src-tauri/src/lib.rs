pub mod deepseek;
pub mod error;
pub mod state;
pub mod scheduler;
pub mod store;

pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
