# 改用安裝版設計

目標：日常使用可以從開發模式（`start-dev.sh`）換成安裝版，而且：

- 看到同一份資料
- 每次開 app 大約 1 秒就能用（現在是 8 到 10 秒）
- macOS 上從網路下載後打得開

這份設計由四部分組成：統一資料位置、onedir、macOS ad-hoc 簽章、安裝說明。
安裝版目前只給維護者自己用，所以不做 Developer ID 簽章與公證。

## 現況（2026-09-27 實測）

| 問題 | 事實 |
|---|---|
| 資料分成兩份 | 開發模式的 sidecar 和 launchd 的 collector 用 `~/.starscope`；安裝版由 Rust 傳入 `TAURI_APP_DATA_DIR`，用的是 `~/Library/Application Support/com.nealchen.starscope`。改用安裝版會看到空的資料庫，collector 寫的資料也看不到 |
| 冷啟動慢 | onefile 每次啟動都要解壓整個包。從 `open` 到 `/api/health` 回應：onefile 第一次 25.9 秒，之後 8.4 到 8.7 秒；onedir 第一次 2.2 秒，之後 1.0 秒 |
| macOS 下載後打不開 | v1.0.0 的 aarch64 版只有 linker 產生的 ad-hoc 簽章，`codesign --verify` 失敗（code has no resources but signature indicates they must be present）。帶 quarantine 打開時，系統顯示「已損毀」，而且沒有「強制打開」可以按 |
| Intel 版不能用 | v1.0.0 的 x64 dmg 包進去的是 89 bytes 的 placeholder。main 上已經由 `check_sidecar_binary.py` 擋住 |

Gatekeeper 的實測結果（macOS 26、arm64，用 quarantine 屬性模擬 Safari 下載）：

- 簽章壞掉、而且系統從沒判定過的 app：「已損毀」，在 GUI 裡沒有任何辦法打開
- ad-hoc 正確簽章、而且系統從沒判定過的 app（onefile、onedir 都一樣）：「Apple 無法驗證」。按「完成」之後，到「系統設定 → 隱私權與安全性」按「強制打開」，app 就能用
- Gatekeeper 會快取第一次的判定：同一個 app 先被判成「已損毀」，重新簽章之後還是「已損毀」。所以驗證時一定要用 CDHash 不同、系統從沒見過的副本
- `xattr -d com.apple.quarantine StarScope.app`（不需要遞迴）就能打開；裡面的 dylib 還帶著 quarantine 也不會被擋
- 還沒搬進「應用程式」就直接打開的 app 會被 App Translocation 搬到唯讀位置執行，Rust 用 `resource_dir()` 一樣找得到 onedir

## 決定

| 項目 | 做法 | 理由 |
|---|---|---|
| 資料位置 | 開發模式、安裝版、collector 都用 `~/.starscope` | 不必搬動真實資料，改動最小，三個平台行為一致。Application Support 雖然是 macOS 的慣例，但搬過去要同時改三處，任何一處漏掉，資料又會分成兩份 |
| 打包格式 | PyInstaller onedir，整個資料夾當成 Tauri `resources` 打包 | externalBin 只能放單一執行檔；在 macOS 上 externalBin 放在 `Contents/MacOS`，`_internal` 放不進它旁邊 |
| symlink | 打包前自己攤平，不依賴 Tauri 的處理方式 | 實測 Tauri 會把指向檔案的 symlink 換成檔案、直接丟掉指向資料夾的 symlink，而且不會有任何提示。這不是文件寫明的行為 |
| macOS 簽章 | `bundle.macOS.signingIdentity: "-"`，CI 用 `codesign --verify` 把關 | 只要一行設定，就能讓「已損毀」變成「可強制打開」。實測 Tauri 用 `-` 簽出的簽章能通過驗證，`Resources` 底下的 211 個檔案（其中 209 個是 onedir）都在簽章範圍內 |
| Windows 結束 sidecar | `kill()` 直接結束 Python，接受不做優雅關閉 | onefile 時 `kill()` 只殺得到 bootloader，Python 是由看門機制優雅結束的；onedir 沒有 bootloader。直接結束保證不會留下孤兒行程；SQLite 每次 commit 都是原子的，最壞只丟掉一次進行中的抓取，collector 每小時會再抓一次 |
| 公證 | 不做 | 安裝版只有維護者自己用。將來如果要做，onedir 裡每個 Mach-O 都要用 Developer ID 簽章並開啟 hardened runtime |

## 1. 統一資料位置

- `src-tauri/src/lib.rs`：不再傳 `TAURI_APP_DATA_DIR`。
- `sidecar/db/database.py`：`get_app_data_dir()` 移除 `TAURI_APP_DATA_DIR` 這個分支，優先序變成 `STARSCOPE_DATA_DIR`（測試與隔離用）→ `~/.starscope`。說明文字不再把 `~/.starscope` 寫成「開發環境回退」。
- sidecar 的 log（`main.py`）和診斷頁顯示的路徑（`routers/app_settings.py`）都透過 `get_app_data_dir()` 取得，會自動跟著改。
- 不搬、不刪、不讀 Application Support 底下的任何東西。09-25 已經重現過：之前所有 Release 的 sidecar 都因為入口錯誤（`uvicorn.run("main:app")`）起不來，所以那裡不會有 StarScope 的資料。
- 已知影響：前端存在 localStorage 的設定（主題、語言、Dashboard 小工具、清單排序、Trends 自動更新、已關掉的推薦、已讀通知）在開發模式（`localhost:1420`）和安裝版之間不互通，切換後要重新設定一次。
- 與 collector 同時跑：安裝版會整天開著，collector 每小時跑一次，兩者經常同時抓資料、寫同一個資料庫。這在設計上本來就安全（見 `run_jobs.py` 開頭）：要不要抓看的是資料庫裡的 `fetched_at`，兩邊會透過資料庫自然錯開；最壞的情況是重複抓一輪相同的值，而寫入是冪等的。不需要改動。
- 版本不一致：安裝版和開發模式可能跑不同版本的程式碼，卻共用同一個資料庫。`ensure_columns()` 只做加法（新增欄位、索引），舊版程式會忽略它不認識的欄位和資料表，所以只要 schema 變更維持加法，兩邊就能共用。CLAUDE.md 的「schema 變更」一節要把這一點寫成規則。

## 2. onedir

### 打包

1. `sidecar/starscope-sidecar.spec` 改成 `EXE(exclude_binaries=True)` 加上 `COLLECT`，輸出到 `dist/starscope-sidecar/`，內容是 `starscope-sidecar`（Windows 是 `.exe`）和 `_internal/`。
   - 檔名不再帶 target triple。
   - `upx=False`。UPX 壓縮過的 macOS dylib 簽章會失效。
2. 新增 `scripts/stage_sidecar.py <onedir> <dest>`：先清空 `dest`，再複製 onedir 過去，同時處理 symlink：
   - 指向檔案：換成檔案本身
   - 指向資料夾、而且目標在同一棵樹裡：移除（它只是別名，透過真實路徑還是拿得到內容）
   - 懸空、或指向樹外面：直接失敗
3. `src-tauri/tauri.conf.json`：
   - 移除 `externalBin`
   - 加上 `bundle.resources: {"sidecar/": "sidecar/"}`
   - 加上 `bundle.macOS.signingIdentity: "-"`
4. 移除 `src-tauri/binaries/`，包括 placeholder 和 README。`src-tauri/sidecar/` 只放一份 README，其餘內容加進 gitignore。
   - 目錄存在，`tauri-build` 就編得過，開發模式和 `cargo test` 都不需要任何假的執行檔。
   - 「Tauri 靜默打包 placeholder」這一類問題從此不可能發生。忘了 stage 的話，只會打包到那份 README，下面的檢查會擋下來。

### Rust

- sidecar 路徑是 `resource_dir()/sidecar/starscope-sidecar`，再加上 `std::env::consts::EXE_SUFFIX`，用 `app.shell().command(path)` 啟動。Rust 端的 `command()` 不經過 capability scope 檢查。
- 啟動前先確認檔案存在，不存在就直接 `report_spawn_failed`。檔案不在時重試也不會好，不應該讓使用者白等十幾秒。
- debug build 不啟動 sidecar，只回報 `External` 後直接返回。開發模式的 sidecar 一直是由 `start-dev.sh` 提供的。
- `capabilities/default.json` 移除 `shell:allow-spawn`，因為前端沒有用到 shell plugin。
- 註解與文件依照 onedir 改寫：現在只有一個行程。Unix 的 SIGTERM 直接送到 Python；Windows 的 `kill()` 直接結束 Python。看門機制保留，負責處理 app 當掉或被強制結束的情況。涉及的地方：`cleanup_sidecar`、`Cargo.toml` 的 libc 註解、`parent_watchdog.py`、CLAUDE.md。

### 檢查與 CI

- `scripts/check_sidecar_binary.py` 改成檢查資料夾：執行檔存在、架構正確（沿用現有的 Mach-O、ELF、PE 判斷）、`_internal/` 存在、沒有任何 symlink。
- setup-sidecar action 的步驟：PyInstaller → 對 `dist/` 跑 smoke test → stage 到 `src-tauri/sidecar/` → 檢查。
- `release.yml` 在 tauri-action 之後新增兩個步驟，正式發版和預演都跑：
  - **對安裝檔裡的 sidecar 跑 smoke test**：
    - macOS 用 `.app/Contents/Resources/sidecar/`
    - Linux 用 `dpkg-deb -x` 解開 `.deb`
    - Windows 用 `msiexec /a` 解開 `.msi`
    
    這是唯一能證明「使用者實際裝到的那份能跑」的方法。正式發版也要跑，因為 draft release 在這一步之前就已經建立了，job 變紅可以提醒不要發佈。
  - **macOS 的 `codesign --verify --deep --strict`**
- `scripts/smoke-test-sidecar.sh`：改寫 onefile 相關的註解。逾時維持 120 秒，因為 Windows 第一次啟動時會被防毒軟體掃描。
- `scripts/run-packaged-app.sh`：打包 onedir → stage 到 WORK → 用 `--config` 覆寫 resources。`--config` 是 JSON merge patch，要用 `"sidecar/": null` 把 repo 的那一項清掉，否則兩個來源會被打包到同一個目標。殘留檢查改看 `Contents/Resources/sidecar/`。
- Rust 測試直接讀 `tauri.conf.json`，鎖住三件事：沒有 `externalBin`、resources 對應到 `sidecar/`、`signingIdentity` 是 `-`。寫法仿照系統列圖示那個測試。

### 前端

`STARTUP_GRACE_MS` 維持 45 秒，因為 macOS 第一次啟動時，掃描新檔案最慢實測到 26 秒。只改說明它由來的那段註解。

## 3. 安裝說明

- README 的「macOS — 首次開啟」：
  - 方法 1：打開 app，看到「Apple 無法驗證」時按「完成」，再到「系統設定 → 隱私權與安全性」按「強制打開」
  - 方法 2：`xattr -d com.apple.quarantine /Applications/StarScope.app`
  - 移除「右鍵 → 開啟 → 確認開啟」。實測右鍵打開後的視窗沒有「打開」可以按
  - 註明每次更新之後都要再做一次；v1.0.0 只有方法 2 有效
- `release.yml` 的 `releaseBody`：macOS 那行附上 README 的連結。
- CHANGELOG `[Unreleased]`：資料位置和 onedir 各寫一條，只寫使用者看得到的變化。

## 測試

- Python：
  - 設了 `TAURI_APP_DATA_DIR` 時會被忽略，資料位置仍是 `~/.starscope`；`STARSCOPE_DATA_DIR` 仍優先
  - `stage_sidecar.py` 的三種 symlink 各自處理正確，懸空與指向樹外面的會失敗
  - `check_sidecar_binary.py` 的資料夾檢查：通過、缺執行檔、缺 `_internal`、有 symlink、架構錯誤
- Rust：
  - sidecar 路徑的組法（含 Windows 的副檔名）
  - 檔案不存在時直接回報 SpawnFailed，不重試
  - `tauri.conf.json` 的三項設定
- 本機打包版：用 `run-packaged-app.sh`（隔離資料）實測啟動時間、四種結束方式（關視窗、Cmd+Q、系統列 Quit、強制結束）都沒有殘留，以及第二次開啟正常
- 發版預演：四個平台全綠，包括安裝檔 smoke test 和 codesign 檢查
- 打 tag 之後、發佈 draft 之前：用瀏覽器從 draft 下載 aarch64 的 dmg（這樣才會帶真的 quarantine），右鍵打開，預期出現「Apple 無法驗證」，強制打開後要能用
- 切換（由維護者自己做）：先停掉 `start-dev.sh`，再用真實資料打開安裝版，確認資料都在、collector 仍持續寫入，並記下讀 Keychain 的提示實際長什麼樣（ad-hoc 簽章每次重新打包雜湊值都會變，可能每次更新後都會再問一次）

## 風險

- Windows 覆蓋安裝時，舊版多出來的檔案可能留在 `sidecar/` 裡。那是 Python 不會 import 的多餘檔案，所以不處理，只記錄下來。
- 開發模式和安裝版都用 8008，不能同時開：
  - 安裝版後開：顯示「連接埠被佔用」卡片（既有行為）
  - `start-dev.sh` 後開：它會對佔著 8008 的行程 `kill -9`，也就是殺掉安裝版的 sidecar，安裝版於是顯示「資料引擎已停止」。資料不會壞（SQLite），但安裝版要重開才會恢復
  - 安裝版開著時跑 `tauri dev`：debug build 不檢查 port，dev 前端會連到安裝版的 sidecar，session secret 對不上，整片 403。這個情況原本就存在，改用安裝版後更容易碰到。CLAUDE.md 的開發流程要寫明：開發前先關掉安裝版

## 這次會消失的延後項目

- SIGTERM 逾時改送 SIGKILL 時，log 寫「強制終止」，但 Python 子行程其實還在
- 根治「只有 bootloader 死掉」的缺口（shared_child）

## 不做的事

- Developer ID 簽章與公證、Windows 程式碼簽章
- 搬移 localStorage 的設定
- 之前延後的其他生命週期小項目
- 調整 `STARTUP_GRACE_MS`
