# sidecar 生命週期設計

打包版的 app 關閉之後，sidecar 會留下來佔著 port。下一次開 app，新的 sidecar 綁不到
port 就退出，前端連到的是舊的那個——它拿的是上一次的 session secret，每個請求都 403。
app 從第二次開啟起完全不能用，直到重開機或手動殺掉行程。開發模式（`start-dev.sh`）
不經過這條路，所以日常用開發模式時碰不到。

這份設計讓每一種結束方式都把 sidecar 收乾淨，並讓 sidecar 在父行程消失時自己結束。
onefile → onedir（冷啟動 8–10 秒 → 0.7 秒）是另一個子專案，不在這裡。

## 重現（2026-09-26，macOS arm64，PyInstaller onefile 打包的 sidecar）

| 步驟 | 結果 |
|---|---|
| 以 secret A 啟動，前端帶 A | 200 |
| 對 bootloader 父行程送 SIGKILL（等同 Tauri `CommandChild::kill()`） | Python 子行程仍在，port 仍有回應 |
| 以 secret B 再啟動一個 | 8.6 秒後 exit 1（綁不到 port） |
| 前端帶 B | **403** |
| 改對父行程送 SIGTERM | 0.98 秒內父子都結束，port 釋放，日誌有 uvicorn 正常關閉 |

`lib.rs` 只在 `WindowEvent::CloseRequested` 清理 sidecar；系統列 Quit（`app.exit(0)`）、
Cmd+Q、app 當掉或被強制結束都不會清理，不論 onefile 或 onedir 都會留下行程。

## 決定

| 層 | 做法 | 補的洞 |
|---|---|---|
| L1 所有結束路徑都清理 | `RunEvent::Exit` 呼叫 `cleanup_sidecar`；`CloseRequested` 的保留 | 系統列 Quit、Cmd+Q |
| L2 優雅結束整棵行程樹 | Unix 先對 child pid 送 SIGTERM，最多等 3 秒，還在才 `kill()` | onefile 的 SIGKILL 只殺到 bootloader |
| L3 sidecar 自己看門 | Tauri 以 `STARSCOPE_PARENT_PID` 傳自己的 PID；sidecar 每 2 秒檢查，父行程不在就優雅結束 | 當掉、強制結束、Windows 的 onefile 子行程 |

只做 L3 不夠：之後改成 onedir、啟動只要 0.7 秒時，關掉馬上重開會撞上還沒退出的舊行程。

## Tauri 端（L1、L2）

- `.run(tauri::generate_context!())` 改成 `.build(...)` 後 `.run(|app, event| …)`，在
  `RunEvent::Exit` 呼叫 `cleanup_sidecar(app)`。Tauri 2.11 的 `ExitRequested` 涵蓋
  「使用者操作（關掉所有視窗、Cmd+Q）」與「`app.exit()`」，之後才進 `Exit`。
- `cleanup_sidecar` 本來就以 `take()` 取出 child，呼叫兩次無害。
- Unix：`libc::kill(pid, SIGTERM)`，每 50ms 以 `kill(pid, 0)` 檢查是否已結束（shell plugin
  的等待執行緒會回收子行程），3 秒後仍在才呼叫 `child.kill()`（SIGKILL）。onefile 的
  bootloader 會把 SIGTERM 轉給 Python 子行程（實測，見上表）。
- Windows：沒有 SIGTERM，維持 `child.kill()`；onefile 的 Python 子行程由 L3 收掉。
- spawn 時加 `STARSCOPE_PARENT_PID = std::process::id()`。
- 新增 `libc` 依賴（Unix only，`[target.'cfg(unix)'.dependencies]`）。

## sidecar 端（L3）

`sidecar/utils/parent_watchdog.py`：

- `parent_alive(pid) -> bool`
  - POSIX：`os.kill(pid, 0)`；`ProcessLookupError` → False，`PermissionError` → True
  - Windows：ctypes `OpenProcess(SYNCHRONIZE)`＋`WaitForSingleObject(handle, 0)`；
    打不開或已 signaled → False。**不能**在 Windows 用 `os.kill(pid, 0)`：那會
    `TerminateProcess` 掉父行程
- `start_parent_watchdog(pid, on_parent_gone, interval=2.0)`：daemon thread，
  第一次發現父行程不在就呼叫 `on_parent_gone()` 後結束
- `run_server()` 的非 reload 分支改為自己建立 `uvicorn.Server(uvicorn.Config(app, ...))`；
  讀得到 `STARSCOPE_PARENT_PID` 時啟動看門，callback 設 `server.should_exit = True`，
  走 uvicorn 的正常關閉（lifespan shutdown：停排程、關 HTTP client）
- 沒有 `STARSCOPE_PARENT_PID` 就不啟動：`start-dev.sh`、e2e、headless collector、
  pytest 行為不變。值不是正整數時記一條 WARNING、不啟動（不讓啟動失敗）

已知限制：父行程結束後 2 秒內 PID 被別的行程重用，看門會以為父行程還在。機率極低，
而且 L1／L2 已經處理正常結束。

## 測試

Python（`sidecar/tests/test_parent_watchdog.py`）：

- `parent_alive` 對自己的 pid 為 True；對一個已結束並回收的子行程 pid 為 False
- 看門在注入的檢查函式回 False 時呼叫 callback、之後停止；回 True 時不呼叫
- 整合：以原始碼啟動真的 sidecar（空的 port、隔離資料目錄、null keyring、空 token），
  `STARSCOPE_PARENT_PID` 指向一個 `sleep` 行程；殺掉它後 sidecar 在 10 秒內以 0 結束、
  port 釋放。對照：不設環境變數時殺掉 `sleep`，sidecar 3 秒後仍在
- `STARSCOPE_PARENT_PID` 不是數字時不啟動看門、記 WARNING

打包產物（`scripts/smoke-test-sidecar.sh`，release 與 verify-sidecar 在三個 OS 上都跑）：

- 既有的健康檢查之後加一段：以一個背景 `sleep` 當父行程啟動 binary，殺掉它，binary
  要在 15 秒內結束、port 釋放
- Windows 的 Git Bash 裡 `$!` 是 MSYS pid，要從 `/proc/$!/winpid` 取 Windows PID

Rust（L1、L2）：CI 不編譯 Rust，只能本機驗證。`cargo build`／`cargo test` 通過後，
實際跑一次打包版 app，分別以關視窗、Cmd+Q、系統列 Quit 結束，每次確認 `pgrep` 找不到
殘留的 sidecar，並確認第二次開啟一切正常。打包版會讀鑰匙圈的 token 做 star 同步——
這一步要使用者同意才跑，或由使用者自己跑。

## 不做的事

- onefile → onedir（另一個子專案）
- 作業系統層的行程群組（Windows Job Object、Unix process group）：各平台專用程式碼，
  macOS 仍需 L3
- 啟動時偵測並清掉別人留下的舊 sidecar（pidfile）：L3 讓舊行程在父行程消失後 2 秒內自己結束
- CI 補 Rust 編譯 job（建議之後另做）
