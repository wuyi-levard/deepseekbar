// src-tauri/src/tray.rs

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Emitter,
};

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(app, "show_hide", "显示/隐藏窗口", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "立即刷新", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let privacy = MenuItem::with_id(app, "privacy", "隐私模式", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&show_hide, &refresh, &sep1, &privacy, &settings, &sep2, &quit],
    )?;

    TrayIconBuilder::with_id("main")
        .tooltip("DeepSeekBar")
        .icon(app.default_window_icon().cloned().unwrap())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_hide" => toggle_window(app),
            "refresh" => {
                let _ = app.emit("balance:manual_refresh", ());
            }
            "privacy" => {
                let _ = app.emit("mode:changed", serde_json::json!({ "mode": "toggle_privacy" }));
            }
            "settings" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
                let _ = app.emit("mode:changed", serde_json::json!({ "mode": "settings" }));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn toggle_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        match win.is_visible() {
            Ok(true) => { let _ = win.hide(); }
            _ => { let _ = win.show(); let _ = win.set_focus(); }
        }
    }
}
