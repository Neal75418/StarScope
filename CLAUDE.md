# CLAUDE.md

> Claude Code 在本專案中工作時的指引文件。
>
> **撰寫原則**：只記錄「從 code 看不出來的事」——路徑陷阱、跨層約定、函式庫的反直覺行為、設計取捨的理由。可以用一行指令查到的東西（有哪些服務、有哪些表、有幾個路由）**不寫進文件**，因為 `ls` 的答案永遠正確，而文件會過時。

**文件分工**：

| 文件                      | 讀者                                              | 內容                                                                                                                       |
|---------------------------|---------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------|
| `README.md`               | 對外                                              | 專案介紹、安裝、API 端點表                                                                                                 |
| **本檔**                  | Claude Code，每個 session                         | 指令、跨層約定、跨層陷阱、**現行**設計取捨                                                                                                   |
| `.claude/rules/*.md`      | Claude Code，讀到檔頭 `paths:` 符合的檔案時才載入 | 單一層的約定與陷阱：`sidecar.md`（Python）、`frontend.md`（React）、`sidecar-lifecycle.md`（Rust、啟停相關檔案、腳本、CI） |
| `docs/superpowers/specs/` | 需要知道「當初為什麼這樣決定」時                  | 各功能定案當下的設計紀錄。**刻意不隨程式碼更新**，讀法見該目錄的 `README.md`                                               |

⚠️ **工程規約不寫成散文。** 每條約束都放在會失敗的地方：coverage 門檻在 `vitest.config.ts`、bundle 上限在
`scripts/check-bundle-size.sh`、降級等級是 `DegradationLevel` 這個 union type、事件名與錯誤訊息是 `constants/` 裡的
具名常數、sidecar 的 shutdown 順序由 `sidecar/tests/test_main_lifecycle.py` 斷言。**要知道規則是什麼就去看那些地方**——
它們違反時會紅，散文不會。本檔與 rules 只記錄「機器守不住、且從 code 看不出來」的部分。

⚠️ **`src/api/types.ts` 是手寫的，沒有任何機制擋前後端型別漂移**（曾有的 `scripts/check-api-drift.sh` 守錯方向——只檢查
「後端有、前端沒宣告」，對「前端宣告了後端根本不送的欄位」完全瞎——也沒有任何地方執行它，已刪）。真的被漂移咬到時，正解是啟用 `npm run generate:types`（`openapi-typescript`）讓型別從 OpenAPI
schema 產生，drift 就結構上不可能發生——**不要再寫一支更好的檢查腳本**。代價是現有型別的中文說明註解會被沖掉，所以在痛之前不必先做。

⚠️ **「有一個 config 在那裡」不等於「有人執行它」。** 加或改任何 gate 之後一定做兩件事，否則你守的是一個裝飾品：

1. **grep 誰執行它**，找不到引用點就是死的。plain `tsc` 不會跟著檢查 tsconfig `references` 指到的 project（只有 `tsc -b` 會），
   所以 `type-check` **不用 `references`，改為明確串接三個 `tsc -p`**——串了哪些讀 `package.json`，不要相信這裡的敘述。
2. **注入一個必被抓到的錯，確認它真的紅**（`const __g = 1; __g.toUpperCase();`），而且**指令與旗標要跟真實消費者一致**
   （CI 跑 `npm run type-check`，IDE 跑不帶旗標的 `tsc -p`；只加 `allowJs` 沒加 `checkJs` 的「零錯誤」是假的）。
   **「跑個檢查指令」不等於唯讀**：不帶 `--noEmit` 的 `tsc` 會把 `.js` 寫回原始碼旁邊，同名 `.js` 會遮蔽 `.ts`。
   `tsconfig.node.json` 的 `outDir` 不能拿掉：`composite: true` 強制 emit，沒有 `outDir` 時 IDE 的 `tsc -p` 報 `TS5055`。
   判涵蓋範圍用 `tsc -p <config> --listFilesOnly`，不要自己 parse tsconfig（JSON with comments）。

---

## 專案概述

StarScope 是桌面應用程式，透過速度分析（而非 star 絕對數量）幫助工程師理解 GitHub 專案的發展動能。Tauri v2：
`src-tauri/`（Rust，系統匣、OS 通知、spawn 並監管 sidecar）、`src/`（React 19）、`sidecar/`（FastAPI＋SQLite，:8008，
對 GitHub 與 Hacker News API）。架構圖見 README。

應用分兩層：**發現層**（Discovery 頁的 For You feed——依使用者興趣清單每日產生個人化推薦）與**監測層**（Watchlist、Trends、
Compare、警報——對已追蹤 repo 做時序快照與訊號分析）。監測層的所有功能都依賴發現層或使用者手動把 repo 加入 watchlist，
watchlist 為空時整個監測層不會有資料。

⚠️ **Python sidecar 是 Rust 進程 spawn 出來的子進程**（`src-tauri/src/lib.rs`），不是獨立服務。App 關掉時它要跟著收——
開發時手動起 sidecar 忘了關，下次會直接撞埠。

---

## 常用指令

### 前端

```bash
npm run dev              # Vite 開發伺服器（僅前端）
npm run tauri dev        # 完整 Tauri 應用程式
npm run build            # 建構前端
npm run type-check       # 型別檢查（src + 設定檔 + e2e 三個 project 串接）
npm run lint             # ESLint 檢查
npm run lint:fix         # ESLint 自動修復
npm run format           # Prettier 格式化
npm run build:analyze    # Bundle 大小分析
```

### Python Sidecar

⚠️ **一律走 `sidecar/.venv/`，不要用裸 `python` / `pytest`。** macOS 內建的 `python3` 是 3.9，而 `constants.py` 與
`db/models.py` 用了 `StrEnum`（Python 3.11+，共 11 個類別的基底），裸執行會直接 `ImportError: cannot import name 'StrEnum'`。
Python 版本以 repo 根目錄的 `.python-version`（3.13）為準：CI 的 `actions/setup-python` 讀它，本機 venv 也要用同一版
（`python3.13 -m venv`；`uv venv --seed`、pyenv 會自動讀），mypy 不另設 `python_version`、跟著直譯器走。
升版改 `.python-version`，然後跑 `tests/test_python_version_single_source.py`：它會指出 README、本段、CI 裡還有哪裡沒跟上，
也會在本機 venv 不是這一版時變紅。

```bash
cd sidecar
.venv/bin/python main.py                           # 啟動 FastAPI :8008
.venv/bin/python -m pytest tests/ -v               # 執行所有測試
.venv/bin/python -m pytest tests/test_repos.py -v  # 單一測試檔
.venv/bin/python -m pytest tests/ --cov=.          # 覆蓋率
.venv/bin/ruff check --fix .                       # Python lint（CI 也跑；規則明確列在 ruff.toml，不吃 Ruff 預設值）
```

venv 不存在時：`cd sidecar && python3.13 -m venv .venv && .venv/bin/pip install -r requirements.txt -c constraints.txt`

Rust：`cd src-tauri && cargo test --lib`（`test.yml` 不編譯 Rust；Windows／Linux 只在 `release.yml` 編）。

### 單元測試（Vitest）

```bash
npx vitest run            # 跑一次就退出 ← 要「跑完拿結果」用這個
npm run test              # ⚠️ 等同 `vitest`，是 watch 模式，不會退出
npm run test:ui           # Vitest UI 模式
npm run test:coverage     # 覆蓋率報告
```

### E2E 測試

```bash
npm run test:e2e          # Playwright 全部測試
npm run test:e2e:chromium # 僅 Chromium
npm run test:e2e:ui       # 互動式 UI 模式
npm run test:e2e:headed   # 顯示瀏覽器視窗
```

⚠️ 本機一律 `E2E_NO_TOKEN=1 npm run test:e2e:chromium`：不加的話 e2e 的 sidecar 讀得到 Keychain token，
「加入追蹤」會真的在 GitHub 上按 star。

e2e 大量 Loading 逾時時先看 `/tmp/starscope-e2e/starscope.log` 的 `-->`／`<--` 數量：對不起來就是 sidecar 卡住，不是測試 flaky。

### 完整開發流程

```bash
./start-dev.sh                  # 建議：檢查 venv、清掉佔用 8008 的殘留 process、trap 訊號時一併關掉 sidecar
```

⚠️ 開發前先關掉安裝版：兩者都用 8008。`start-dev.sh` 會 `kill -9` 佔著 8008 的行程，也就是安裝版的 sidecar；
安裝版開著時直接跑 `tauri dev`，dev 前端會連到安裝版的 sidecar，session secret 對不上，整片 403。

手動兩個終端機的話要自己清 port（上次沒關乾淨會直接撞埠）：`lsof -ti:8008 | xargs kill -9`，然後
`cd sidecar && .venv/bin/python main.py`（終端機 1）與 `npm run tauri dev`（終端機 2）。

---

## 專案結構

目錄結構用 `ls` 就看得到（README 有完整樹狀圖），這裡只記從名字看不出來的：

- `sidecar/routers/dependencies.py` **不是端點模組**，是 `Depends()` 的共用注入 helper——數路由模組時要扣掉它
- `src-tauri/src/main.rs` 只是進入點，實作全在 `lib.rs`（sidecar 管理、系統匣、視窗控制、存檔 command `save_file`）
- 前端測試散在各目錄的 `__tests__/`，不是集中一處

## 環境設定

⚠️ **repo 裡有兩份 `.env.example`，用途不同**：`sidecar/.env.example` 是 Python 端（`GITHUB_CLIENT_ID` / `GITHUB_TOKEN` /
`PORT` 等），根目錄的是 Vite 端（`VITE_API_URL`）。內容直接 `cat` 該檔，這裡不複製一份免得漂移。不設 token 也能跑，只是
GitHub 配額降到 60/hr。

---

## 測試策略與發版

| 類型       | 工具                       | 位置                                                                                   |
|------------|----------------------------|----------------------------------------------------------------------------------------|
| 單元測試   | Vitest                     | `src/**/__tests__/`                                                                    |
| 後端測試   | pytest（非同步）           | `sidecar/tests/`                                                                       |
| E2E 測試   | Playwright                 | `e2e/`                                                                                 |
| CI         | GitHub Actions             | `.github/workflows/test.yml`                                                           |
| 發佈前驗證 | GitHub Actions（手動觸發） | `release.yml`（預演：完整編譯、打包）、`verify-sidecar.yml`（只打包 sidecar）          |

⚠️ **打 tag 前先在 main 上手動跑 `Release`（預演），四個 job 全綠再打。** 手動觸發時不建立 release，只照發版的步驟
編譯、打包，並多跑一次 `cargo test --lib --locked`。`test.yml` 不編譯 Rust、也不打包 sidecar，安裝檔層級的問題（Rust 在
Windows／Linux 編不編得過、安裝檔裡的 sidecar 能不能跑、簽章）只有預演看得到（v1.0.0 以前每一版的 sidecar 都起不來，
Intel 版還包著 placeholder）。只改 sidecar 時可先跑 `verify-sidecar.yml`
（約 2 分鐘）：它和 release 共用 `setup-sidecar` action——打包、smoke test、stage 進 `src-tauri/sidecar/`、確認是對應架構的
完整 onedir。release（含預演）另外從安裝檔（.app、.deb 與 AppImage、.msi；NSIS 的 .exe 與 .rpm 沒驗）取出 sidecar 再跑一次
smoke test，macOS 並驗證簽章。

打包版本機實測用 `scripts/run-packaged-app.sh`（只支援 macOS）：隔離資料、不讀 token、不動 repo 的 `src-tauri/sidecar/`；
前端 localStorage 與已安裝的 StarScope 共用，隔離不了。⚠️ 從終端機啟動時視窗不會到前景：被蓋住的 WebView 整頁暫停
（計時器、請求都不跑），要先點一下視窗再觀察。

### 跨層陷阱

- ⚠️ **API 時間要帶時區**：sidecar response model 的 datetime 欄位用 `UtcDateTime`、手寫輸出用 `to_utc_iso()`
  （`sidecar/schemas/time.py`，`tests/test_api_timestamps_utc.py` 守住）。只有日期的值用 `formatCalendarDate`／`localDateStamp`，
  不要經本地時區轉換。前端 `doFetch` 補 `Z` 是雙保險，新增的 fetch 路徑仍要經過它。CI 跑在 UTC 看不出時區 bug，測試要自己設
  `process.env.TZ`
- ⚠️ **資料庫位置（最常踩的坑）**：SQLite **不在 repo 目錄裡**。`db/database.py` 的 `get_app_data_dir()`：`STARSCOPE_DATA_DIR`
  （測試、smoke test、打包版實測的隔離）→ `~/.starscope`（開發模式、安裝版、launchd 的 collector 共用這一份，**也就是真實資料**）。
  任何會啟動打包版或 sidecar 的實驗都要設 `STARSCOPE_DATA_DIR`。Rust 不能用任何環境變數傳資料目錄給 sidecar，`STARSCOPE_DATA_DIR`
  也不行（它最優先）：以前傳過 `TAURI_APP_DATA_DIR`，安裝版就看不到 collector 寫的資料。Python 端忽略 `TAURI_APP_DATA_DIR` 由
  `tests/test_app_data_dir.py` 守住，Rust 端沒有測試守。除錯找資料庫時別在 `sidecar/` 底下找
- 所有端點回傳統一的 `ApiResponse[T]`：`{success, data, message, error}`。前端 `client.ts` 的 `doFetch` **會自動 unwrap `data`
  欄位**——新增端點時若忘了包 `success_response()`，前端會拿到 undefined
- 桌面應用的前端與後端一起打包發佈（同一個 Tauri binary），版本始終一致，因此 API 不需要 `/api/v1/` 版本前綴
- ⚠️ Tauri 的 WebView 不處理 `<a download>`（wry 沒有 download handler 時直接取消），存檔一律用 `utils/saveFile`
- ⚠️ 正式版 CSP 的 `img-src` 不含 `blob:`：單元測試與 Vite 下的 e2e 都沒有 CSP，這類錯誤只會在正式版出現
- ⚠️ tauri-plugin-dialog 會把 `window.confirm` 換成回傳 Promise 的版本（永遠 truthy）；ESLint 的 `no-alert` 擋著，確認一律用 `ConfirmDialog`
- ⚠️ 改 Tauri 平台或 scheme 時同步 `sidecar/main.py` 的 `get_allowed_origins()`：漏一個＝那個平台每個請求 403（Windows 是 `http://tauri.localhost`）

---

## 提交慣例

提交前跑一次（husky 的 pre-commit 只擋 token 外洩與 prettier，不跑型別與測試）：

```bash
npm run lint && npm run format:check && npm run type-check
cd sidecar && .venv/bin/ruff check . && .venv/bin/mypy . --config-file mypy.ini && .venv/bin/python -m pytest tests/ -q
```

Commit 訊息用 [Conventional Commits](https://www.conventionalcommits.org/)（`feat` / `fix` / `docs` / `refactor` / `test` /
`perf` / `chore`，可帶 scope，例：`feat(watchlist): add batch import`）。程式碼風格：TypeScript 走 Prettier + ESLint
（`npm run lint:fix`），Python 走 Ruff（`.venv/bin/ruff check --fix .`）。

## 註解與日誌慣例

- 註解一律繁體中文，技術術語保留英文；用語統一「回應」不用「響應」
- 只寫程式碼本身看不出來的約束或原因（why），不重述下一行在做什麼，不寫變更史（「原本」「新增」「取代」「簡化後」句式禁用——
  改寫成現在式的約束句）
- 檔案頭一律 `/** */`（TS）／`"""docstring"""`（Python）描述模組職責；公開函式配一行說明（與 Python docstring 全覆蓋的立場一致），
  行內註解只留 why
- **豁免區**（維持原樣，勿翻譯或改寫）：`sidecar/alembic/`（模板產物）、Rust `SAFETY:` 區塊（生態慣例用英文）、`src/test/` 測試基建
- 日誌：Python 用 `[模組名] 繁中訊息`，同一模組固定同一個 prefix，middleware 的 `[request_id]` 動態 prefix 是刻意的請求追蹤格式；
  前端一律走 `utils/logger`（生產環境 no-op），訊息帶 `[元件名]` prefix，唯一例外是 `main.tsx` 的全域 error handler
  （裸 console，理由見該處註解）；Rust 不加 bracket prefix（tracing target 已提供模組上下文）
