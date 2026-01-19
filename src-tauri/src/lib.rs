use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowButton, NSWindowCollectionBehavior};

/// Disable the native macOS fullscreen button to work around
/// a crash in macOS 26 beta during fullscreen transitions.
/// See: https://github.com/tauri-apps/tauri/issues/11336
#[cfg(target_os = "macos")]
fn disable_fullscreen_button(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| {
        // Safety: webview.ns_window() returns a valid NSWindow pointer on macOS
        #[allow(clippy::undocumented_unsafe_blocks)]
        unsafe {
            let ns_window_ptr = webview.ns_window();
            let ns_window: &NSWindow = &*(ns_window_ptr as *const NSWindow);

            // Method 1: Remove fullscreen capability from collection behavior
            let mut behavior = ns_window.collectionBehavior();
            behavior.remove(NSWindowCollectionBehavior::FullScreenPrimary);
            behavior.remove(NSWindowCollectionBehavior::FullScreenAuxiliary);
            ns_window.setCollectionBehavior(behavior);

            // Method 2: Disable the zoom button (green button) directly
            if let Some(zoom_button) = ns_window.standardWindowButton(NSWindowButton::ZoomButton) {
                zoom_button.setEnabled(false);
            }
        }
    });
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Disable fullscreen button on macOS to prevent crash in macOS 26 beta
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                disable_fullscreen_button(&window);
            }

            // Create tray menu
            let show_item = MenuItem::with_id(app, "show", "Show StarScope", true, None::<&str>)?;
            let refresh_item = MenuItem::with_id(app, "refresh", "Refresh All", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show_item, &refresh_item, &quit_item])?;

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("StarScope - GitHub Project Intelligence")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "refresh" => {
                        // Trigger refresh via frontend
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("refresh-all", ());
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        // Show window on left click
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
