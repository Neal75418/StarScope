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
- `src-tauri/**` 有變動時，`rust.yml` 在 Linux 跑 `cargo clippy --all-targets --locked -- -D warnings` 與 `cargo test --lib --locked`
  （警告也算失敗）；四個平台的編譯仍只在 `release.yml` 的預演。`tauri` 與 `@tauri-apps/api`、`tauri-plugin-X` 與
  `@tauri-apps/plugin-X` 要在同一個 major.minor（`tauri build` 對不上會直接失敗），升級要兩邊一起；Cargo.toml 的 tauri
  用 `~` 鎖在一個 minor（`sidecar/tests/test_tauri_versions.py` 守住）。rust.yml 裝的是沒釘版本的 stable：新版 clippy
  多出來的 lint 可能讓無關的 src-tauri 改動突然紅，當下修掉 lint 即可（不要只在 rust.yml 釘版本，會跟 release 用的不同）
- Dependabot（`.github/dependabot.yml`）每週開 actions／npm／cargo、每月開 pip 的 PR，新版發佈 7 天後才提（cooldown）；
  `sidecar/tests/test_dependabot.py` 守住涵蓋範圍。
  - tauri 的 npm 與 cargo 是兩個 PR：minor 升級（含 plugin）時各自都會紅（`test_tauri_versions.py`），GitHub 上也沒辦法一起合。
    把一邊的 commit cherry-pick 到另一邊的分支（兩邊改的檔案不重疊），在本機跑
    `cd sidecar && .venv/bin/python -m pytest tests/test_tauri_versions.py -q`。
    - 還是紅、而且是 npm 的 plugin 升了但 crate 沒升：多半是 Dependabot 對那個 crate 判了「No update possible」（Dependabot
      Updates 的 log 搜 crate 名可以確認），cargo 卻可能升得上去（2026-11 的 notification 2.5→2.8：新版要 tauri-plugin
      `^2.7.1`，lock 裡是 2.7.0）。在 `src-tauri/` 跑 `cargo update -p <crate> --precise <npm 那邊的版本>`；失敗（例如新版要的
      tauri minor 超出 `~2.12`）就把 npm 那邊的 plugin 退回同一個 minor，tauri 的 minor 改天兩邊一起升
    - 成功之後拿補之前的 Cargo.lock 用 `git diff` 逐條比對：
      - 版本有變、新增或移除的 package：要能從新版本的需求推出來，而且每個版本都要過 7 天 cooldown（`--precise` 連帶升的是
        需求允許的最高版，不看發佈時間），沒過就等過了再做，或把 npm 那邊退回
      - 版本沒變的 crate，依賴邊改指同名的另一個版本，而原本那個版本還在 lock 裡（找得到它的 `[[package]]`）：是順帶被改寫的，
        改回原本的值。cargo 1.99 兩次都有，大多是無關 crate 的 `windows-sys` 改指舊版，tokio 那次還有一條 `syn`
      - 不要動的：原本那個版本已經不在 lock 裡的（只寫名字的邊，例如 `tauri-utils`）；版本沒變的 crate 多了或少了一條邊
        （feature 變了，例如 getrandom 多了 `rand_core`）；只是補上或拿掉版本號、指的還是同一個版本的（同名的版本數變了，
        例如 `cpufeatures` 變成 `cpufeatures 0.2.17`）
    - 改完跑 `cargo metadata --locked --format-version 1 >/dev/null`，它只證明 lock 合法、cargo 不會再改寫，不證明改回的是
      原本的值，所以要再跟補之前的 lock diff 一次，確認只剩推得出來的變動，然後再跑一次 `test_tauri_versions.py`
    - 推上去，等 test.yml 與 rust.yml 綠燈再合；剩下那個 PR Dependabot 下一輪看到版本已經更新通常會自己關，沒關就手動關。
  - npm 的 typescript：major 被 ignore（工具鏈還不支援，擋在哪、何時拿掉見 dependabot.yml 的註解），minor 不進
    npm-minor-and-patch、單獨開 PR（minor 會改 lib.d.ts 的型別，在那個 PR 修型別錯誤）。處理 npm-minor-and-patch 的 PR 時，
    順便用 `npm view typescript-eslint peerDependencies` 與 `npm view openapi-typescript peerDependencies` 看 typescript 的範圍，
    納入新的 major 就照 dependabot.yml 的註解改 ignore
  - actions 的 PR 會改 `release.yml` 與 `setup-sidecar` 的 pin，它們只在手動觸發或打 tag 時跑。只動到 setup-python 或
    checkout 時，合併後跑 `verify-sidecar.yml` 就夠；動到 `release.yml` 的其他 action（setup-node、rust-cache、upload／download-artifact）
    要跑發版預演，verify-sidecar 不會用到它們。
  - pip 的 PR 處理方式見 `.claude/rules/sidecar.md`。
- `release.yml` 的權限拆開：build（只能讀）在各平台產出安裝檔、上傳成 artifact；能改寫 release 的 token 只給 publish，
  它用 `scripts/release_assets.py verify` 逐個 artifact 核對過檔名才建 draft。外部 action 一律寫成
  `owner/repo@<40 字元 SHA> # vX.Y.Z`、checkout 一律 `persist-credentials: false`（`sidecar/tests/test_github_workflows.py` 守住）；
  正式發版不讀 rust-cache（快取的編譯產物不驗內容）。改 matrix 的 target 要一起改 `release_assets.py` 的 INSTALLERS 與預期檔名
- Windows 的 `resource_dir()` 來自 canonicalize、帶 `\\?\` 前綴：`locate_sidecar` 先 `dunce::simplified` 再交給 PyInstaller

## 存檔走 Rust 的 `save_file` command，不註冊 fs plugin

- 前端只交出內容與建議檔名（`src/utils/saveFile.ts`），對話框與寫檔都在 Rust；capabilities 不開任何 `dialog:*`／`fs:*`
- 不用 fs plugin：dialog 選過的檔、拖進視窗的檔案與資料夾（遞迴）會留在可寫 scope 直到 app 關閉，前端被注入腳本就能不經對話框寫入
- 檔名在 Rust 端淨化（`sanitize_save_file_name`）：Windows 與 GTK 的檔名欄接受完整路徑

## CSP `style-src 'unsafe-inline'`

`tauri.conf.json` 的 CSP 用 `style-src 'self' 'unsafe-inline'`：Recharts 在 runtime 注入 inline styles，無法避免。
`unsafe-inline` 僅在 `style-src`，`script-src` 沒有（那才是關鍵的安全邊界）；桌面 app 不暴露於公網，XSS 攻擊面遠小於 Web。
可接受的 tradeoff；若未來 Recharts 支援 nonce-based CSP，應升級。
