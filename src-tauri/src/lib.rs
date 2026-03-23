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

/// 保存 per-session secret，用於驗證前端對 sidecar 的 API 請求。
struct SessionSecretState {
    secret: String,
}

/// 產生一個 per-session 隨機 secret（64 hex chars = 256 bits）。
/// 使用 `getrandom` CSPRNG 確保密碼學安全性。
fn generate_session_secret() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("OS RNG unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Tauri command：讓前端取得 session secret 以附加至 API 請求 header。
#[tauri::command]
fn get_session_secret(state: tauri::State<'_, SessionSecretState>) -> String {
    state.secret.clone()
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
                warn!("取得 NSWindow 指標失敗 — 指標為 null");
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
        warn!("停用全螢幕按鈕失敗: {e}");
    }
}

/// Sidecar 啟動重試的最大次數。
const MAX_RETRIES: u32 = 3;
/// Sidecar 啟動重試的初始延遲（毫秒），每次重試倍增。
const INITIAL_DELAY_MS: u64 = 500;

/// 計算第 n 次重試的 exponential backoff delay（毫秒）。
/// 使用 `saturating_mul` 防止大 attempt 值溢出。
fn retry_delay_ms(attempt: u32, initial_delay_ms: u64) -> u64 {
    initial_delay_ms.saturating_mul(2u64.pow(attempt))
}

/// 啟動 Python sidecar，失敗時以 exponential backoff 重試，最終優雅降級。
/// 透過 `Command::env()` 傳遞 app data dir 及 session secret，
/// 避免在多執行緒環境呼叫 `std::env::set_var`。
/// 在背景執行緒中執行，避免阻塞 UI 主執行緒。
fn start_sidecar(app: &App) {
    // 先註冊空的 SidecarState，讓其他元件可以安全存取
    app.manage(SidecarState {
        child: Mutex::new(None),
    });

    // 產生 per-session secret 並註冊到 Tauri state，供前端透過 command 取得
    let secret = generate_session_secret();
    app.manage(SessionSecretState {
        secret: secret.clone(),
    });

    let app_handle = app.app_handle().clone();
    std::thread::spawn(move || {
        start_sidecar_with_retry(&app_handle, &secret);
    });
}

/// 在背景執行緒中以 exponential backoff 重試啟動 sidecar。
fn start_sidecar_with_retry(app: &AppHandle, session_secret: &str) {
    for attempt in 0..=MAX_RETRIES {
        // 每次重試都重建 Command，因為 spawn() 會 consume self。
        let mut cmd = match app.shell().sidecar("starscope-sidecar") {
            Ok(c) => c,
            Err(e) => {
                // 找不到 binary 表示檔案不存在，重試無意義。
                warn!("找不到 sidecar: {e}，開發環境請執行 './start-dev.sh'");
                return;
            }
        };

        // 將 app data dir 與 session secret 透過環境變數傳給 sidecar 子程序，
        // 而非使用 std::env::set_var（在多執行緒環境有 data race 風險）。
        if let Ok(app_data_dir) = app.path().app_data_dir() {
            cmd = cmd.env("TAURI_APP_DATA_DIR", app_data_dir.to_string_lossy().to_string());
        }
        cmd = cmd.env("STARSCOPE_SESSION_SECRET", session_secret);

        match cmd.spawn() {
            Ok((_rx, child)) => {
                if attempt > 0 {
                    info!("Sidecar 在第 {attempt} 次重試後啟動成功");
                }
                if let Ok(mut guard) = app.state::<SidecarState>().child.lock() {
                    *guard = Some(child);
                }
                return;
            }
            Err(e) => {
                if attempt < MAX_RETRIES {
                    let delay_ms = retry_delay_ms(attempt, INITIAL_DELAY_MS);
                    warn!(
                        "Sidecar 啟動失敗 (嘗試 {}/{}): {e}，{delay_ms}ms 後重試",
                        attempt + 1,
                        MAX_RETRIES + 1
                    );
                    std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                } else {
                    warn!(
                        "Sidecar 啟動失敗 (嘗試 {}/{})，已達重試上限: {e}，開發環境請執行 './start-dev.sh'",
                        attempt + 1,
                        MAX_RETRIES + 1
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_delay_first_attempt() {
        assert_eq!(retry_delay_ms(0, 500), 500);
    }

    #[test]
    fn retry_delay_second_attempt() {
        assert_eq!(retry_delay_ms(1, 500), 1000);
    }

    #[test]
    fn retry_delay_third_attempt() {
        assert_eq!(retry_delay_ms(2, 500), 2000);
    }

    #[test]
    fn retry_delay_zero_initial() {
        assert_eq!(retry_delay_ms(0, 0), 0);
        assert_eq!(retry_delay_ms(3, 0), 0);
    }

    #[test]
    fn retry_delay_saturates_on_overflow() {
        // 2^63 * 2 would overflow u64; saturating_mul clamps to u64::MAX
        assert_eq!(retry_delay_ms(63, 2), u64::MAX);
    }

    #[test]
    fn retry_constants_are_expected_values() {
        assert_eq!(MAX_RETRIES, 3);
        assert_eq!(INITIAL_DELAY_MS, 500);
    }
}

/// 設定系統匣圖示與選單。
fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show StarScope", true, None::<&str>)?;
    let refresh_item = MenuItem::with_id(app, "refresh", "Refresh All", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &refresh_item, &quit_item])?;

    // 安全取得預設視窗圖示，未設定時回傳錯誤
    // 需要 clone — TrayIconBuilder::icon() 會取得所有權
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
                    warn!("發送 refresh-all 事件失敗: {e}");
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
            warn!("顯示主視窗失敗: {e}");
        }
        if let Err(e) = window.set_focus() {
            warn!("聚焦主視窗失敗: {e}");
        }
    }
}

/// 視窗關閉時清理 sidecar 程序。
fn cleanup_sidecar(app: &AppHandle) {
    let Some(state) = app.try_state::<SidecarState>() else { return };
    let Ok(mut child_guard) = state.child.lock() else { return };
    let Some(child) = child_guard.take() else { return };
    if let Err(e) = child.kill() {
        warn!("終止 sidecar 程序失敗: {e}");
    } else {
        info!("Sidecar 程序已成功終止");
    }
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
        .invoke_handler(tauri::generate_handler![get_session_secret])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                disable_fullscreen_button(&window);
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
        .run(tauri::generate_context!())
        .expect("致命錯誤：無法啟動 Tauri 應用程式，請檢查 WebView 運行環境與連接埠可用性");
}
