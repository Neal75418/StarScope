---
paths:
  - "src-tauri/**"
  - "src/api/sidecarConnection.ts"
  - "src/api/__tests__/sidecarConnection*"
  - "src/App.tsx"
  - "src/utils/saveFile.ts"
  - "sidecar/utils/parent_watchdog.py"
  - "sidecar/main.py"
  - "sidecar/tests/test_parent_watchdog*.py"
  - "sidecar/tests/test_main_lifecycle.py"
  - "scripts/**"
  - "start-dev.sh"
  - ".github/**"
---

# sidecar 生命週期、打包與 Tauri 端

只在讀到 Rust、啟停相關的三層檔案（含它們的測試）、腳本或 CI 設定時載入。指令與發版流程在根目錄 `CLAUDE.md`。

## 生命週期：不能破壞的

改啟停邏輯前先讀 `src-tauri/src/lib.rs` 的 `cleanup_sidecar`、`start_sidecar_with_retry` 與 `sidecar/utils/parent_watchdog.py`。

- 每一種正常結束都要走到 `cleanup_sidecar`：Cmd+Q、系統列 Quit 不觸發 `CloseRequested`，只走 `RunEvent::Exit`。
  當掉、被強制結束時走不到它，只能靠 sidecar 的父行程看門
- sidecar 結束後不能再對它的 PID 送任何 signal（可能已換人）：「已結束」看 shell plugin 的 `Terminated`，不用 `kill(pid, 0)`
- 看門不能拿掉：app 當掉、被強制結束時只能靠它。看門只在有 `STARSCOPE_PARENT_PID` 時啟動；start-dev、e2e、collector、pytest 都不設
- sidecar 是 onedir（`src-tauri/sidecar/`，作為 Tauri resources 打包），只有一個行程：Unix 的 SIGTERM
  直接送到 Python；Windows 的 `kill()` 直接結束 Python，不走正常關閉（SQLite 每次 commit 都是原子的，最壞丟掉一次進行中的抓取）
- debug build 不 spawn sidecar：開發時由 `start-dev.sh` 提供
- `/api/health` 不驗 session secret，別人的 sidecar（舊版孤兒、還在退出的上一個）也答得出來：
  前端在 Tauri 裡要等 Rust 的 `sidecar-status` 說 `running`／`external` 才探測
- `start_sidecar_with_retry` 的每一條出口都要 `set_sidecar_status`：前端關著探測閘門等它，漏設的話畫面停在「啟動中」、
  重試鈕按了也不會探測
- release 在 spawn 前檢查 8008：StarScope 佔著就等最多 6 秒（上一個正在退出），仍被佔或是別的程式就不 spawn、
  回報 `port_in_use`；Rust 回報的原因由 `App.tsx` 換成說明卡片，不掛頁面
- single-instance 只在 release 註冊：dev 與 release 共用 identifier，否則打包版開著時 `tauri dev` 會一聲不響地結束
- 改 Tauri 平台或 scheme 時同步 `sidecar/main.py` 的 `get_allowed_origins()`：漏一個＝那個平台每個請求 403（Windows 是 `http://tauri.localhost`）

打包後的 binary 用 `scripts/smoke-test-sidecar.sh` 跑，它另外 cd 到暫存目錄、清空 token、keyring 換成 null、指定 `STARSCOPE_DATA_DIR`；
健康檢查通過後殺掉假的父行程，binary 要在 15 秒內自己結束並放開 port。

## 打包

- `src-tauri/sidecar/` 在 repo 裡只有 README。CI 的 `setup-sidecar` action 用 `scripts/stage_sidecar.py` 把 PyInstaller 的 onedir
  放進去（先攤平 symlink：Tauri 會把指向資料夾的 symlink 默默丟掉），再由 `scripts/check_sidecar_binary.py` 確認架構與完整性。
  本機 `scripts/run-packaged-app.sh` 把 onedir 放在暫存目錄、用 `--config` 覆寫 resources——那是 JSON merge patch，要用
  `null` 拿掉 repo 那一項，否則 README 會一起被打包
- `tauri.conf.json` 的 `bundle.macOS.signingIdentity: "-"`：沒有完整的 bundle 簽章時，下載的 app 在 Apple Silicon 上被判
  「已損毀」、沒有強制打開可按；CI 以 `codesign --verify --deep --strict` 把關。`lib.rs` 的測試鎖住 resources、簽章、
  沒有 `externalBin`、沒有設定檔的 `trayIcon`（會多一個沒選單的白色方塊）
- Windows 的 `resource_dir()` 來自 canonicalize、帶 `\\?\` 前綴：`locate_sidecar` 先 `dunce::simplified` 再交給 PyInstaller

## 存檔走 Rust 的 `save_file` command，不註冊 fs plugin

- 前端只交出內容與建議檔名（`src/utils/saveFile.ts`），對話框與寫檔都在 Rust；capabilities 不開任何 `dialog:*`／`fs:*`
- 不用 fs plugin：dialog 選過的檔、拖進視窗的檔案與資料夾（遞迴）會留在可寫 scope 直到 app 關閉，前端被注入腳本就能不經對話框寫入
- 檔名在 Rust 端淨化（`sanitize_save_file_name`）：Windows 與 GTK 的檔名欄接受完整路徑

## CSP `style-src 'unsafe-inline'`

`tauri.conf.json` 的 CSP 用 `style-src 'self' 'unsafe-inline'`：Recharts 在 runtime 注入 inline styles，無法避免。
`unsafe-inline` 僅在 `style-src`，`script-src` 沒有（那才是關鍵的安全邊界）；桌面 app 不暴露於公網，XSS 攻擊面遠小於 Web。
可接受的 tradeoff；若未來 Recharts 支援 nonce-based CSP，應升級。
