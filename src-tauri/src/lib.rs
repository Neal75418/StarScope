use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

/// State to hold the sidecar child process for cleanup on exit
struct SidecarState {
    child: Mutex<Option<CommandChild>>,
}

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowButton, NSWindowCollectionBehavior};

/// Disable the native macOS fullscreen button to work around
/// a crash in macOS 26 beta during fullscreen transitions.
/// See: https://github.com/tauri-apps/tauri/issues/11336
#[cfg(target_os = "macos")]
fn disable_fullscreen_button(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| {
        #[allow(clippy::undocumented_unsafe_blocks)]
        unsafe {
            let ns_window_ptr = webview.ns_window();
            let ns_window: &NSWindow = &*(ns_window_ptr as *const NSWindow);

            let mut behavior = ns_window.collectionBehavior();
            behavior.remove(NSWindowCollectionBehavior::FullScreenPrimary);
            behavior.remove(NSWindowCollectionBehavior::FullScreenAuxiliary);
            ns_window.setCollectionBehavior(behavior);

            if let Some(zoom_button) = ns_window.standardWindowButton(NSWindowButton::ZoomButton) {
                zoom_button.setEnabled(false);
            }
        }
    });
}

/// Start the Python sidecar process with graceful fallback
fn start_sidecar(app: &App) {
    let state = match app.shell().sidecar("starscope-sidecar") {
        Ok(cmd) => match cmd.spawn() {
            Ok((_rx, child)) => SidecarState {
                child: Mutex::new(Some(child)),
            },
            Err(e) => {
                eprintln!("Warning: Failed to spawn sidecar: {e}");
                eprintln!("Please run './start-dev.sh' for development.");
                SidecarState {
                    child: Mutex::new(None),
                }
            }
        },
        Err(e) => {
            eprintln!("Warning: Sidecar not found: {e}");
            eprintln!("Please run './start-dev.sh' for development.");
            SidecarState {
                child: Mutex::new(None),
            }
        }
    };
    app.manage(state);
}

/// Set up the system tray icon and menu
fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show StarScope", true, None::<&str>)?;
    let refresh_item = MenuItem::with_id(app, "refresh", "Refresh All", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &refresh_item, &quit_item])?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("StarScope - GitHub Project Intelligence")
        .on_menu_event(handle_tray_menu_event)
        .on_tray_icon_event(handle_tray_click)
        .build(app)?;

    Ok(())
}

/// Handle tray menu item clicks
fn handle_tray_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        "show" => show_main_window(app),
        "refresh" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("refresh-all", ());
            }
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

/// Handle tray icon click (show window on left click)
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

/// Show and focus the main window
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Clean up sidecar process on window close
fn cleanup_sidecar(app: &AppHandle) {
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Ok(mut child_guard) = state.child.lock() {
            if let Some(child) = child_guard.take() {
                let _ = child.kill();
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
