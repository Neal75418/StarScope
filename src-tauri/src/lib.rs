//! StarScope Tauri 應用程式核心邏輯，包含 sidecar 管理、系統匣與視窗控制。

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_shell::{process::CommandChild, ShellExt};
use tracing::{info, warn};

/// 保存 sidecar 子程序以便退出時清理。
struct SidecarState {
    child: Mutex<Option<CommandChild>>,
}

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowButton, NSWindowCollectionBehavior};

/// 停用 macOS 原生全螢幕按鈕，繞過 macOS 26 beta 全螢幕切換時的當機問題。
/// See: https://github.com/tauri-apps/tauri/issues/11336
#[cfg(target_os = "macos")]
fn disable_fullscreen_button(window: &tauri::WebviewWindow) {
    if let Err(e) = window.with_webview(|webview| {
        // SAFETY: ns_window_ptr is guaranteed to be valid within the with_webview callback scope.
        // The webview object remains alive throughout the closure execution, ensuring the pointer
        // reference is valid. We verify the pointer is non-null before dereferencing.
        unsafe {
            let ns_window_ptr = webview.ns_window();

            // Verify pointer is non-null before dereferencing
            if ns_window_ptr.is_null() {
                warn!("Failed to get NSWindow pointer - pointer is null");
                return;
            }

            let ns_window: &NSWindow = &*(ns_window_ptr as *const NSWindow);

            let mut behavior = ns_window.collectionBehavior();
            behavior.remove(NSWindowCollectionBehavior::FullScreenPrimary);
            behavior.remove(NSWindowCollectionBehavior::FullScreenAuxiliary);
            ns_window.setCollectionBehavior(behavior);

            if let Some(zoom_button) = ns_window.standardWindowButton(NSWindowButton::ZoomButton) {
                zoom_button.setEnabled(false);
            }
        }
    }) {
        warn!("Failed to disable fullscreen button: {e}");
    }
}

/// 啟動 Python sidecar，失敗時優雅降級。
fn start_sidecar(app: &App) {
    let state = match app.shell().sidecar("starscope-sidecar") {
        Ok(cmd) => match cmd.spawn() {
            Ok((_rx, child)) => SidecarState {
                child: Mutex::new(Some(child)),
            },
            Err(e) => {
                warn!("sidecar 啟動失敗: {e}，開發環境請執行 './start-dev.sh'");
                SidecarState {
                    child: Mutex::new(None),
                }
            }
        },
        Err(e) => {
            warn!("找不到 sidecar: {e}，開發環境請執行 './start-dev.sh'");
            SidecarState {
                child: Mutex::new(None),
            }
        }
    };
    app.manage(state);
}

/// 設定系統匣圖示與選單。
fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show StarScope", true, None::<&str>)?;
    let refresh_item = MenuItem::with_id(app, "refresh", "Refresh All", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &refresh_item, &quit_item])?;

    // 安全取得預設視窗圖示，未設定時回傳錯誤
    let icon = app
        .default_window_icon()
        .ok_or("No default window icon configured in tauri.conf.json")?
        .clone();

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("StarScope - GitHub Project Intelligence")
        .on_menu_event(handle_tray_menu_event)
        .on_tray_icon_event(handle_tray_click)
        .build(app)?;

    Ok(())
}

/// 處理系統匣選單點擊事件。
fn handle_tray_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        "show" => show_main_window(app),
        "refresh" => {
            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) = window.emit("refresh-all", ()) {
                    warn!("Failed to emit refresh-all event: {e}");
                }
            }
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

/// 處理系統匣圖示點擊（左鍵顯示視窗）。
fn handle_tray_click(tray: &tauri::tray::TrayIcon, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        show_main_window(tray.app_handle());
    }
}

/// 顯示並聚焦主視窗。
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.show() {
            warn!("Failed to show main window: {e}");
        }
        if let Err(e) = window.set_focus() {
            warn!("Failed to focus main window: {e}");
        }
    }
}

/// 視窗關閉時清理 sidecar 程序。
fn cleanup_sidecar(app: &AppHandle) {
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Ok(mut child_guard) = state.child.lock() {
            if let Some(child) = child_guard.take() {
                if let Err(e) = child.kill() {
                    warn!("Failed to kill sidecar process: {e}");
                } else {
                    info!("Sidecar process terminated successfully");
                }
            }
        }
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "starscope_lib=info".into()),
        )
        .init();

    info!("StarScope 啟動中");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                disable_fullscreen_button(&window);
            }

            if let Ok(app_data_dir) = app.path().app_data_dir() {
                std::env::set_var(
                    "TAURI_APP_DATA_DIR",
                    app_data_dir.to_string_lossy().to_string(),
                );
            }

            start_sidecar(app);
            setup_tray(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                cleanup_sidecar(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
