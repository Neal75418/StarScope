//! StarScope Tauri 應用程式核心邏輯，包含 sidecar 管理、系統匣與視窗控制。

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use tauri::async_runtime::Receiver;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent, TerminatedPayload},
    ShellExt,
};
use tracing::{info, warn};

/// 保存 sidecar 子程序以便退出時清理。
struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    /// shell plugin 回報 sidecar 已結束（並已回收）時設起來。結束後它的 PID 可能分給別的
    /// 行程，cleanup_sidecar 看到這個旗標就不再送任何 signal
    exited: Arc<AtomicBool>,
    /// 給前端看的狀態：前端的 health 探測分辨不出「答話的是不是自己的 sidecar」
    status: Mutex<SidecarStatus>,
    /// cleanup_sidecar 開始收 sidecar 時設起來：那之後的結束是關 app，不是引擎停了
    quitting: Arc<AtomicBool>,
}

/// sidecar 固定的 port：與 sidecar/main.py 的 PORT 預設、前端 src/config.ts 一致
const SIDECAR_PORT: u16 = 8008;
/// 檢查 port 被誰佔著的總時間上限（連線加讀回應）：對方慢慢回也不能拖住 sidecar 的啟動
const PORT_PROBE_BUDGET: Duration = Duration::from_secs(1);
/// 佔著 port 的是 StarScope 時，等它放開的上限：上一個 app 剛關或剛當掉時，它的 sidecar
/// 最慢要 cleanup 的 3 秒＋看門的 2 秒才開始關閉（關閉時先放開 port）
const STARSCOPE_RELEASE_WAIT: Duration = Duration::from_secs(6);
const STARSCOPE_RELEASE_POLL: Duration = Duration::from_millis(250);
/// sidecar 狀態變化時送給前端的事件
const SIDECAR_STATUS_EVENT: &str = "sidecar-status";

/// 誰佔著 sidecar 的 port（沒人佔時 port_holder 回 None）
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum PortOwner {
    /// 答得出 StarScope 的 health：舊版留下的孤兒，或開發中的 sidecar
    Starscope,
    Other,
}

/// 前端需要、但自己查不到的 sidecar 狀態。
///
/// 前端在 Tauri 裡收到 Running／External 才開始探測 health：health 不驗 session secret，
/// 別人的 sidecar（舊版孤兒、正在退出的上一個）也答得出來，前端會以為連上而整片 403
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum SidecarStatus {
    /// 還在檢查 port 或正在 spawn
    Starting,
    /// 已 spawn 自己的 sidecar：port 檢查時是空的，答話的只會是它
    Running,
    /// 開發模式：資料由 start-dev.sh 的 sidecar 提供，不自己 spawn
    External,
    /// port 被佔著所以沒有啟動：佔用者的 health 可能答得出來（舊版孤兒），前端會以為連上了，
    /// 但它拿的是別的 session secret，每個請求都 403
    PortInUse { holder: PortOwner },
    /// 沒能啟動：找不到 sidecar 執行檔，或重試用完仍 spawn 失敗（安裝不完整）
    SpawnFailed,
    /// sidecar 結束了（沒有自動重啟）
    Exited { code: Option<i32> },
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

/// 匯出與下載：在 Rust 端開原生「另存新檔」並寫檔，回傳是否已儲存（取消為 false）。
///
/// 不用 fs plugin 讓前端寫檔：那樣 dialog 選過的檔、以及拖進視窗的檔案與資料夾（遞迴）
/// 都會留在 fs scope 直到 app 關閉，前端一旦被注入腳本就能不經對話框寫進去。
/// 這裡前端只交出內容與建議檔名，永遠拿不到可寫的路徑。
///
/// 也不用 `<a download>`：wry 在沒有 download handler 時會直接取消 WKWebView 的下載，
/// macOS 上按了沒有任何反應。
const SAVE_FILE_EXTENSIONS: [&str; 4] = ["json", "csv", "txt", "png"];

/// 前端給的建議檔名只留最後一段、換掉保留字元，副檔名限定在匯出會用到的幾種。
///
/// 對話框的檔名欄在 Windows 與 GTK 接受完整路徑：不淨化的話，被注入的前端雖然寫不了檔，
/// 仍能把對話框預設到任意位置（例如開機啟動資料夾），使用者按一下 Enter 就寫進去了
fn sanitize_save_file_name(requested: &str) -> String {
    let last = requested.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = last
        .chars()
        .map(|c| if c.is_control() || ":*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if cleaned.is_empty() {
        return "starscope-export.txt".to_string();
    }
    match cleaned.rsplit_once('.') {
        Some((stem, ext)) if SAVE_FILE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()) => {
            format!("{stem}.{}", ext.to_ascii_lowercase())
        }
        Some((stem, _)) if !stem.is_empty() => format!("{stem}.txt"),
        _ => format!("{cleaned}.txt"),
    }
}

#[tauri::command]
async fn save_file(
    window: tauri::WebviewWindow,
    default_name: String,
    contents: Vec<u8>,
) -> Result<bool, String> {
    let file_name = sanitize_save_file_name(&default_name);
    let mut dialog = window.dialog().file().set_parent(&window).set_file_name(&file_name);
    if let Some((_, extension)) = file_name.rsplit_once('.') {
        dialog = dialog.add_filter(extension.to_uppercase(), &[extension]);
    }
    // async command 不在主執行緒上跑，blocking 版本才不會卡住 UI
    let Some(chosen) = dialog.blocking_save_file() else {
        return Ok(false);
    };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    let len = contents.len();
    std::fs::write(&path, contents).map_err(|e| format!("{}: {e}", path.display()))?;
    info!("saved {len} bytes to {}", path.display());
    Ok(true)
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
        exited: Arc::new(AtomicBool::new(false)),
        status: Mutex::new(SidecarStatus::Starting),
        quitting: Arc::new(AtomicBool::new(false)),
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
    // port 被佔著就不啟動：啟動了也綁不到 port、白等 8 秒後 exit 1，而前端會連到佔用者。
    // 開發時 start-dev.sh 本來就在 8008 跑自己的 sidecar：不檢查 port，讓前端直接探測
    if cfg!(debug_assertions) {
        set_sidecar_status(app, SidecarStatus::External);
    } else if let Some(holder) =
        wait_for_port(|| port_holder(SIDECAR_PORT), STARSCOPE_RELEASE_WAIT, STARSCOPE_RELEASE_POLL)
    {
        warn!("連接埠 {SIDECAR_PORT} 已被佔用（{holder:?}），不啟動 sidecar");
        set_sidecar_status(app, SidecarStatus::PortInUse { holder });
        return;
    }

    for attempt in 0..=MAX_RETRIES {
        // 每次重試都重建 Command，因為 spawn() 會 consume self。
        let mut cmd = match app.shell().sidecar("starscope-sidecar") {
            Ok(c) => c,
            Err(e) => {
                // 解析不出 sidecar 的路徑（shell plugin 不檢查檔案存不存在：檔案不見時是下面的
                // spawn 失敗、重試用完才回報），重試無意義
                warn!("找不到 sidecar: {e}，開發環境請執行 './start-dev.sh'");
                report_spawn_failed(app);
                return;
            }
        };

        // 將 app data dir 與 session secret 透過環境變數傳給 sidecar 子程序，
        // 而非使用 std::env::set_var（在多執行緒環境有 data race 風險）。
        if let Ok(app_data_dir) = app.path().app_data_dir() {
            cmd = cmd.env("TAURI_APP_DATA_DIR", app_data_dir.to_string_lossy().to_string());
        }
        cmd = cmd.env("STARSCOPE_SESSION_SECRET", session_secret);
        // sidecar 以它看門（sidecar/utils/parent_watchdog.py）：app 當掉或被強制結束、
        // cleanup_sidecar 來不及跑時，sidecar 發現父行程不在就自己結束
        cmd = cmd.env("STARSCOPE_PARENT_PID", std::process::id().to_string());

        // 發行版必須以 production 模式跑 sidecar：main.py 的 ENV 預設是
        // development（docs 端點開著、CORS 多放行 localhost:1420/1421），而整條
        // 打包鏈先前沒有任何地方設它——「正式環境才關閉」的防線從未生效過
        // （第三方安全審查發現）。用 debug_assertions 區分：tauri dev 是 debug
        // build 不注入，維持開發模式；打包的 release build 注入 production。
        #[cfg(not(debug_assertions))]
        {
            cmd = cmd.env("ENV", "production");
        }

        match cmd.spawn() {
            Ok((rx, child)) => {
                if attempt > 0 {
                    info!("Sidecar 在第 {attempt} 次重試後啟動成功");
                }
                if !cfg!(debug_assertions) {
                    set_sidecar_status(app, SidecarStatus::Running);
                }
                let state = app.state::<SidecarState>();
                let exit_app = app.clone();
                let quitting = state.quitting.clone();
                tauri::async_runtime::spawn(watch_sidecar_exit(rx, state.exited.clone(), move |code| {
                    // 開發時資料由 start-dev.sh 的 sidecar 提供：這裡 spawn 的（若 binaries/ 放了真的
                    // binary）綁不到 8008 就結束，不能因此讓前端說「資料引擎已停止」
                    if !cfg!(debug_assertions) {
                        report_exit(&quitting, code, |status| set_sidecar_status(&exit_app, status));
                    }
                }));
                if let Ok(mut guard) = state.child.lock() {
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
                    report_spawn_failed(app);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_file_name_keeps_ordinary_export_names() {
        for name in [
            "starscope_watchlist_20260925.json",
            "starscope_trends_20260925.csv",
            "starscope-logs-2026-09-25.txt",
            "comparison-chart.png",
        ] {
            assert_eq!(sanitize_save_file_name(name), name);
        }
    }

    #[test]
    fn save_file_name_drops_any_path() {
        // Windows 與 GTK 的檔名欄接受完整路徑：不砍掉的話，被注入的前端能把對話框預設到任意位置
        assert_eq!(sanitize_save_file_name("../../.ssh/authorized_keys.txt"), "authorized_keys.txt");
        assert_eq!(
            sanitize_save_file_name(r"C:\Users\me\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\run.json"),
            "run.json"
        );
    }

    #[test]
    fn save_file_name_forces_an_allowed_extension() {
        assert_eq!(sanitize_save_file_name("run.bat"), "run.txt");
        assert_eq!(sanitize_save_file_name("payload.JSON"), "payload.json");
        assert_eq!(sanitize_save_file_name("no-extension"), "no-extension.txt");
    }

    #[test]
    fn save_file_name_replaces_reserved_characters_and_falls_back_when_empty() {
        assert_eq!(sanitize_save_file_name("a:b*c?.csv"), "a_b_c_.csv");
        assert_eq!(sanitize_save_file_name(""), "starscope-export.txt");
        assert_eq!(sanitize_save_file_name("../"), "starscope-export.txt");
    }

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

    #[test]
    fn wait_until_returns_as_soon_as_the_condition_holds() {
        let mut calls = 0;
        let done = wait_until(|| { calls += 1; calls >= 3 }, Duration::from_secs(1), Duration::from_millis(1));
        assert!(done);
        assert_eq!(calls, 3);
    }

    #[test]
    fn wait_until_gives_up_after_the_timeout() {
        let started = std::time::Instant::now();
        assert!(!wait_until(|| false, Duration::from_millis(100), Duration::from_millis(10)));
        assert!(started.elapsed() >= Duration::from_millis(100));
    }

    /// 起一個子行程並在背景回收它，回收後把旗標設起來（對應 shell plugin 的等待執行緒
    /// 與 watch_sidecar_exit）。stdio 不接測試的輸出：萬一行程漏掉沒收，也不會讓
    /// cargo test 一直等 pipe 關閉
    #[cfg(unix)]
    fn spawn_reaped(script: &str) -> (u32, Arc<AtomicBool>) {
        use std::process::Stdio;
        let mut child = std::process::Command::new("sh")
            .arg("-c")
            .arg(script)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let pid = child.id();
        let exited = Arc::new(AtomicBool::new(false));
        let flag = exited.clone();
        std::thread::spawn(move || {
            let _ = child.wait();
            flag.store(true, Ordering::SeqCst);
        });
        std::thread::sleep(Duration::from_millis(200)); // 讓 trap 先掛上
        (pid, exited)
    }

    /// 測試收尾：只對還沒回收的行程送 SIGKILL，不去碰一個可能已經被別人拿走的 PID
    #[cfg(unix)]
    fn kill_if_running(pid: u32, exited: &AtomicBool) {
        if !exited.load(Ordering::SeqCst) {
            unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL) };
        }
    }

    #[cfg(unix)]
    #[test]
    fn terminate_gracefully_stops_a_process_that_honours_sigterm() {
        let (pid, exited) = spawn_reaped("trap 'exit 0' TERM; while true; do sleep 0.05; done");
        let stopped = terminate_gracefully(pid, || exited.load(Ordering::SeqCst), Duration::from_secs(3));
        // 先收尾再斷言：斷言失敗時行程還活著的話會一直留著
        kill_if_running(pid, &exited);
        assert!(stopped);
    }

    #[cfg(unix)]
    #[test]
    fn terminate_gracefully_reports_a_process_that_ignores_sigterm() {
        // 呼叫端看到 false 才會改用 SIGKILL；這裡自己收尾，而且要在斷言之前
        let (pid, exited) = spawn_reaped("trap '' TERM; while true; do sleep 0.05; done");
        let stopped = terminate_gracefully(pid, || exited.load(Ordering::SeqCst), Duration::from_millis(300));
        kill_if_running(pid, &exited);
        assert!(!stopped);
    }

    #[cfg(unix)]
    #[test]
    fn terminate_gracefully_sends_nothing_once_the_sidecar_has_exited() {
        // sidecar 早就結束的話，它的 PID 可能已經分給使用者的其他行程：一個 signal 都不能送。
        // 這裡用一個活著、收到 SIGTERM 就會結束的行程代表「接手那個 PID 的別人」
        let (pid, exited) = spawn_reaped("trap 'exit 0' TERM; while true; do sleep 0.05; done");
        let stopped = terminate_gracefully(pid, || true, Duration::from_millis(300));
        std::thread::sleep(Duration::from_millis(200));
        let untouched = !exited.load(Ordering::SeqCst);
        kill_if_running(pid, &exited);
        assert!(stopped);
        assert!(untouched);
    }

    /// 在一個空的 port 上回一次 HTTP 回應，回傳那個 port。
    /// 請求必須是打 health 的 HTTP/1.1 且帶 Host：真的 sidecar 對沒有 Host 的請求回 400
    fn serve_once(body: &'static str) -> u16 {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let body = if request.starts_with("GET /api/health HTTP/1.1\r\n")
                    && request.contains("\r\nHost: 127.0.0.1:")
                {
                    body
                } else {
                    "bad request"
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        port
    }

    #[test]
    fn port_holder_reports_a_free_port() {
        let port = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        }; // listener 已關閉
        assert_eq!(port_holder(port), None);
    }

    #[test]
    fn port_holder_recognises_a_starscope_engine() {
        // 舊版留下的孤兒與開發中的 sidecar 都回這個 health（1.0.0 起就是 starscope-engine）
        let port = serve_once(r#"{"success":true,"data":{"status":"ok","service":"starscope-engine"}}"#);
        assert_eq!(port_holder(port), Some(PortOwner::Starscope));
    }

    #[test]
    fn port_holder_reports_another_program() {
        let port = serve_once("<html>something else</html>");
        assert_eq!(port_holder(port), Some(PortOwner::Other));
    }

    /// macOS：別人綁在 0.0.0.0 時，sidecar（uvicorn 設 SO_REUSEADDR）仍綁得到 127.0.0.1，
    /// 而且 127.0.0.1 的流量會進 sidecar——不能因為「連得上」就不啟動
    #[cfg(target_os = "macos")]
    #[test]
    fn port_holder_treats_a_wildcard_listener_as_free_when_loopback_still_binds() {
        let wildcard = std::net::TcpListener::bind("0.0.0.0:0").unwrap();
        let port = wildcard.local_addr().unwrap().port();
        assert_eq!(port_holder(port), None);
        drop(wildcard);
    }

    #[test]
    fn port_holder_gives_up_on_a_holder_that_never_finishes_answering() {
        // 接了連線卻一點一點慢慢回：探測要有總時間上限，不能拖住 sidecar 的啟動
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                for _ in 0..40 {
                    if stream.write_all(b"x").is_err() {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
            }
        });
        let started = std::time::Instant::now();
        assert_eq!(port_holder(port), Some(PortOwner::Other));
        assert!(started.elapsed() < PORT_PROBE_BUDGET + Duration::from_millis(500));
    }

    #[test]
    fn wait_for_port_returns_once_an_exiting_starscope_lets_go() {
        // 上一個 app 剛關（或剛當掉）：它的 sidecar 幾秒內就會放開 port，不能直接判成被佔用
        let mut answers = vec![Some(PortOwner::Starscope), Some(PortOwner::Starscope), None].into_iter();
        let owner = wait_for_port(|| answers.next().unwrap(), Duration::from_secs(1), Duration::from_millis(1));
        assert_eq!(owner, None);
    }

    #[test]
    fn wait_for_port_gives_up_on_a_starscope_that_stays() {
        // 舊版孤兒、開發中的 sidecar 不會自己走：等滿就回報。
        // 第 1000 次之後才「放開」：不停等下去的實作會拿到 None 而失敗，不會讓測試卡住
        let mut probes = 0;
        let started = std::time::Instant::now();
        let owner = wait_for_port(
            || {
                probes += 1;
                if probes > 1000 { None } else { Some(PortOwner::Starscope) }
            },
            Duration::from_millis(100),
            Duration::from_millis(1),
        );
        assert_eq!(owner, Some(PortOwner::Starscope));
        assert!(started.elapsed() >= Duration::from_millis(100));
    }

    #[test]
    fn wait_for_port_does_not_wait_for_another_program() {
        let mut probes = 0;
        let owner = wait_for_port(
            || {
                probes += 1;
                Some(PortOwner::Other)
            },
            Duration::from_secs(5),
            Duration::from_millis(1),
        );
        assert_eq!(owner, Some(PortOwner::Other));
        assert_eq!(probes, 1);
    }

    #[test]
    fn an_exit_during_quit_is_not_reported_as_the_engine_stopping() {
        // 關 app 時 cleanup 會收掉 sidecar：那不是「資料引擎已停止」，前端也不該因此換畫面或通知
        let mut reported = Vec::new();
        report_exit(&AtomicBool::new(true), Some(0), |status| reported.push(status));
        assert!(reported.is_empty());

        report_exit(&AtomicBool::new(false), Some(1), |status| reported.push(status));
        assert_eq!(reported, vec![SidecarStatus::Exited { code: Some(1) }]);
    }

    #[test]
    fn sidecar_status_serialises_the_way_the_frontend_reads_it() {
        let json = |status: SidecarStatus| serde_json::to_string(&status).unwrap();
        assert_eq!(json(SidecarStatus::Starting), r#"{"kind":"starting"}"#);
        assert_eq!(json(SidecarStatus::Running), r#"{"kind":"running"}"#);
        assert_eq!(json(SidecarStatus::External), r#"{"kind":"external"}"#);
        assert_eq!(
            json(SidecarStatus::PortInUse { holder: PortOwner::Starscope }),
            r#"{"kind":"port_in_use","holder":"starscope"}"#
        );
        assert_eq!(
            json(SidecarStatus::PortInUse { holder: PortOwner::Other }),
            r#"{"kind":"port_in_use","holder":"other"}"#
        );
        assert_eq!(json(SidecarStatus::SpawnFailed), r#"{"kind":"spawn_failed"}"#);
        assert_eq!(json(SidecarStatus::Exited { code: Some(1) }), r#"{"kind":"exited","code":1}"#);
        assert_eq!(json(SidecarStatus::Exited { code: None }), r#"{"kind":"exited","code":null}"#);
    }

    #[test]
    fn watch_sidecar_exit_marks_the_sidecar_gone_when_it_terminates() {
        let (tx, rx) = tauri::async_runtime::channel(4);
        let exited = Arc::new(AtomicBool::new(false));
        tauri::async_runtime::block_on(async move {
            tx.send(CommandEvent::Stdout(b"INFO started".to_vec())).await.unwrap();
            tx.send(CommandEvent::Terminated(TerminatedPayload { code: Some(1), signal: None }))
                .await
                .unwrap();
            // 關掉 channel：watch_sidecar_exit 改成「消化到 channel 關閉」也不會讓測試卡住
            drop(tx);
            let reported = Arc::new(Mutex::new(None));
            let sink = reported.clone();
            watch_sidecar_exit(rx, exited.clone(), move |code| *sink.lock().unwrap() = Some(code))
                .await;
            assert!(exited.load(Ordering::SeqCst));
            // exit code 交給呼叫端（前端據此說「資料引擎已停止」）
            assert_eq!(*reported.lock().unwrap(), Some(Some(1)));
        });
    }

    #[test]
    fn watch_sidecar_exit_does_not_guess_when_no_termination_was_reported() {
        // 等待失敗（CommandEvent::Error）時不知道行程還在不在：維持「沒結束」，
        // cleanup_sidecar 會照常收掉它
        let (tx, rx) = tauri::async_runtime::channel(4);
        let exited = Arc::new(AtomicBool::new(false));
        tauri::async_runtime::block_on(async move {
            tx.send(CommandEvent::Error("wait failed".into())).await.unwrap();
            drop(tx);
            let reported = Arc::new(AtomicBool::new(false));
            let sink = reported.clone();
            watch_sidecar_exit(rx, exited.clone(), move |_| sink.store(true, Ordering::SeqCst)).await;
            assert!(!exited.load(Ordering::SeqCst));
            assert!(!reported.load(Ordering::SeqCst));
        });
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
        // 最小化的視窗 show()／set_focus() 都叫不出來，要先還原
        if let Err(e) = window.unminimize() {
            warn!("還原主視窗失敗: {e}");
        }
        if let Err(e) = window.show() {
            warn!("顯示主視窗失敗: {e}");
        }
        if let Err(e) = window.set_focus() {
            warn!("聚焦主視窗失敗: {e}");
        }
    }
}

/// 結束 sidecar 時等 SIGTERM 生效的上限；逾時改用 SIGKILL，不讓 app 卡在結束
const SIDECAR_STOP_TIMEOUT: Duration = Duration::from_secs(3);
const SIDECAR_STOP_POLL: Duration = Duration::from_millis(50);

/// 反覆檢查 `done()` 直到成立或逾時；成立回 true。
fn wait_until(mut done: impl FnMut() -> bool, timeout: Duration, step: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if done() {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(step);
    }
}

/// 消化 sidecar 的事件，直到 shell plugin 回報它結束。
///
/// channel 容量只有 1，一定要有人收：不收的話 stdout／stderr 的讀取執行緒會卡住。
/// 只有 Terminated 才算結束——等待失敗（Error）時不知道行程還在不在，交給 cleanup_sidecar。
async fn watch_sidecar_exit(
    mut rx: Receiver<CommandEvent>,
    exited: Arc<AtomicBool>,
    on_exit: impl FnOnce(Option<i32>),
) {
    while let Some(event) = rx.recv().await {
        if let CommandEvent::Terminated(TerminatedPayload { code, signal }) = event {
            info!("Sidecar 程序已結束（code={code:?}, signal={signal:?}）");
            exited.store(true, Ordering::SeqCst);
            on_exit(code);
            return;
        }
    }
}

/// 看 sidecar 的 port 被誰佔著；沒人佔回 None。
///
/// 先問「綁不綁得到」而不是「連不連得上」：別人綁在 0.0.0.0 時，macOS 上 sidecar（uvicorn 與
/// std 都設 SO_REUSEADDR）仍綁得到 127.0.0.1，流量也會進 sidecar，只看連得上會把能用的情況擋掉。
/// 綁不到才打一次 health 分辨是誰：StarScope 的回應帶 starscope-engine。
/// 只用來決定要不要啟動 sidecar 與怎麼跟使用者說，不殺任何行程（可能是開發中的 sidecar）
fn port_holder(port: u16) -> Option<PortOwner> {
    match TcpListener::bind(("127.0.0.1", port)) {
        Ok(_) => return None,
        Err(e) if e.kind() != std::io::ErrorKind::AddrInUse => return None, // 讓 sidecar 自己試
        Err(_) => {}
    }
    let deadline = std::time::Instant::now() + PORT_PROBE_BUDGET;
    let remaining = || deadline.saturating_duration_since(std::time::Instant::now());
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, remaining()) else {
        return Some(PortOwner::Other);
    };
    let _ = stream.set_write_timeout(Some(remaining()));
    let request = format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return Some(PortOwner::Other);
    }
    let mut response = Vec::new();
    let mut chunk = [0u8; 4096];
    while response.len() < 64 * 1024 {
        let left = remaining();
        if left.is_zero() || stream.set_read_timeout(Some(left)).is_err() {
            break;
        }
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => response.extend_from_slice(&chunk[..n]),
        }
        if String::from_utf8_lossy(&response).contains("starscope-engine") {
            return Some(PortOwner::Starscope);
        }
    }
    Some(PortOwner::Other)
}

/// 更新 sidecar 狀態並通知前端。前端的 JS 可能還沒載入（port 檢查在 setup 就做了），
/// 所以前端啟動時也會用 get_sidecar_status 主動問一次
fn set_sidecar_status(app: &AppHandle, status: SidecarStatus) {
    if let Some(state) = app.try_state::<SidecarState>()
        && let Ok(mut guard) = state.status.lock()
    {
        *guard = status.clone();
    }
    if let Err(e) = app.emit(SIDECAR_STATUS_EVENT, &status) {
        warn!("送出 sidecar 狀態事件失敗: {e}");
    }
}

/// sidecar 結束時回報「已結束」，但 app 正在關閉時不報：那是 cleanup_sidecar 收掉的，
/// 前端不該因此換成「資料引擎已停止」或跳通知
fn report_exit(quitting: &AtomicBool, code: Option<i32>, report: impl FnOnce(SidecarStatus)) {
    if !quitting.load(Ordering::SeqCst) {
        report(SidecarStatus::Exited { code });
    }
}

/// 反覆看 port 被誰佔著，直到空出來。佔用者是 StarScope 才等（正在退出的上一個 sidecar
/// 幾秒內就會放開）；別的程式不會自己走，第一次就回報。等滿仍被佔就回報佔用者
fn wait_for_port(
    mut probe: impl FnMut() -> Option<PortOwner>,
    wait: Duration,
    step: Duration,
) -> Option<PortOwner> {
    let deadline = std::time::Instant::now() + wait;
    loop {
        match probe() {
            Some(PortOwner::Starscope) if std::time::Instant::now() < deadline => {
                std::thread::sleep(step);
            }
            owner => return owner,
        }
    }
}

/// 沒能啟動 sidecar 時告訴前端。只在 release build：開發時 binaries/ 裡是 placeholder，
/// spawn 一定失敗，資料由 start-dev.sh 的 sidecar 提供
fn report_spawn_failed(app: &AppHandle) {
    if !cfg!(debug_assertions) {
        set_sidecar_status(app, SidecarStatus::SpawnFailed);
    }
}

/// 前端啟動時讀一次 sidecar 狀態（之後聽 sidecar-status 事件）
#[tauri::command]
fn get_sidecar_status(state: tauri::State<'_, SidecarState>) -> SidecarStatus {
    state.status.lock().map(|s| s.clone()).unwrap_or(SidecarStatus::Starting)
}

/// 送 SIGTERM 並等 `has_exited()` 成立。onefile 的 bootloader 會把 SIGTERM 轉給 Python
/// 子行程，uvicorn 走正常關閉；直接 SIGKILL 只會殺到 bootloader，Python 子行程留下來佔著 port。
///
/// 已經結束就什麼都不送：它的 PID 可能已經分給別的行程。結束與否看 shell plugin 的回報，
/// 不看 kill(pid, 0)。回報要等 stdout／stderr 的 pipe 全部關閉才送出，所以比回收晚：平常只差
/// 幾毫秒；但 app 執行中若只有 onefile 的 bootloader 被殺、Python 子行程還拿著 pipe，就一直
/// 不會回報，這裡仍會對那個已回收的 PID 送 SIGTERM。要根治得繞過 shell plugin 自己持有子行程
///（shared_child 能在持鎖時確認沒被回收才送 signal）。
#[cfg(unix)]
fn terminate_gracefully(pid: u32, has_exited: impl Fn() -> bool, timeout: Duration) -> bool {
    if has_exited() {
        return true;
    }
    // SAFETY: kill(2) 只對指定 pid 送 signal，不碰這個行程的記憶體
    if unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) } != 0 {
        return false;
    }
    wait_until(has_exited, timeout, SIDECAR_STOP_POLL)
}

/// 結束 sidecar。Unix 先 SIGTERM、等 SIDECAR_STOP_TIMEOUT，仍在才 SIGKILL；
/// Windows 沒有 SIGTERM，直接 kill（onefile 的 Python 子行程由 sidecar 的父行程看門收掉）。
/// 以 take() 取出 child，關視窗與 RunEvent::Exit 都呼叫也不會重複處理。
fn cleanup_sidecar(app: &AppHandle) {
    let Some(state) = app.try_state::<SidecarState>() else { return };
    // 在收 sidecar 之前設：接下來的結束是關 app（見 report_exit）
    state.quitting.store(true, Ordering::SeqCst);
    let Ok(mut child_guard) = state.child.lock() else { return };
    let Some(child) = child_guard.take() else { return };

    // 先藏起視窗：收 sidecar 最多等 SIDECAR_STOP_TIMEOUT，這段時間視窗不該停在畫面上沒反應。
    // 關視窗、Cmd+Q、系統列 Quit 都走到這裡；主執行緒上的 hide() 是同步執行的
    for window in app.webview_windows().values() {
        if let Err(e) = window.hide() {
            warn!("隱藏視窗失敗: {e}");
        }
    }

    #[cfg(unix)]
    {
        let exited = state.exited.clone();
        if terminate_gracefully(child.pid(), || exited.load(Ordering::SeqCst), SIDECAR_STOP_TIMEOUT) {
            info!("Sidecar 程序已正常結束");
            return;
        }
    }

    if let Err(e) = child.kill() {
        warn!("終止 sidecar 程序失敗: {e}");
    } else {
        info!("Sidecar 程序已強制終止");
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

    let builder = tauri::Builder::default();
    // 要最先註冊：第二次開啟時在這裡就被攔下、改叫出現有的視窗（依賴只在桌面平台）。
    // 只在 release：dev 與 release 共用 identifier，也就共用同一個 single-instance 鎖，
    // 否則打包版開著時 tauri dev 會一聲不響地結束（反過來也一樣）
    #[cfg(all(desktop, not(debug_assertions)))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        show_main_window(app);
    }));
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        // 只給 Rust 端的 save_file 用；前端沒有任何 dialog 權限（capabilities 不開）
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_session_secret, save_file, get_sidecar_status])
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
        .build(tauri::generate_context!())
        .expect("致命錯誤：無法啟動 Tauri 應用程式，請檢查 WebView 運行環境與連接埠可用性")
        // 關視窗之外的結束方式（Cmd+Q、系統列 Quit 的 app.exit）不會觸發 CloseRequested；
        // 它們最後都會走到 Exit。沒收掉的 sidecar 會佔著 port，下次開 app 整片 403
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                cleanup_sidecar(app_handle);
            }
        });
}
