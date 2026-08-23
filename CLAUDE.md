# CLAUDE.md

> Claude Code 在本專案中工作時的指引文件。
>
> **撰寫原則**：只記錄「從 code 看不出來的事」——路徑陷阱、跨層約定、函式庫的反直覺行為、設計取捨的理由。可以用一行指令查到的東西（有哪些服務、有哪些表、有幾個路由）**不寫進文件**，因為 `ls` 的答案永遠正確，而文件會過時。

**這個 repo 有兩份文件，各有分工**：

| 文件 | 讀者 | 內容 |
|---|---|---|
| `README.md` | 對外 | 專案介紹、安裝、API 端點表 |
| **本檔** | Claude Code | 路徑陷阱、跨層約定、設計取捨 |

⚠️ **工程規約不寫成散文。** 每條約束都放在會失敗的地方：coverage 門檻在
`vitest.config.ts`、bundle 上限在 `scripts/check-bundle-size.sh`、前後端型別同步在
`npm run check:api-drift`、降級等級是 `DegradationLevel` 這個 union type、事件名與錯誤訊息
是 `constants/` 裡的具名常數、sidecar 的 shutdown 順序由
`sidecar/tests/test_main_lifecycle.py` 斷言。**要知道規則是什麼就去看那些地方**——
它們違反時會紅，散文不會。本檔只記錄「機器守不住、且從 code 看不出來」的部分。

⚠️ **但「有一個 config 在那裡」不等於「有人執行它」。** 加或改任何 gate 之後，
一定要做兩件事，否則你守的是一個裝飾品：

1. **grep 誰執行它。** 找不到引用點就是死的。本專案踩過兩次：`tsconfig.node.json`
   與 `e2e/tsconfig.json` 都存在、看起來在運作，實際上沒有任何地方執行——
   實測往 `vite.config.ts` 塞 `const x: number = "字串"`，`npm run type-check`
   退出碼 0。當時 `tsconfig.json` 靠 `references` 指向前者，但 plain `tsc`
   **只有 `tsc -b` 才會**跟著檢查 referenced project，而全 repo 沒有一處跑 `tsc -b`。
   現在的做法是**不用 `references`，改在 `type-check` 裡明確串接三個 `tsc -p`**——
   要看目前串了哪些，讀 `package.json` 的 `type-check`，不要相信這裡的敘述。
2. **注入一個必被抓到的錯，確認它真的紅**（`const __g = 1; __g.toUpperCase();`）。
   我第一次補這個檢查時只加了 `allowJs` 沒加 `checkJs`，`.js` 進得來但根本不檢查，
   拿到的「零錯誤」是假的。
   ⚠️ 驗證用的**指令與旗標要跟真實消費者一致**：CI 跑 `npm run type-check`，
   IDE 跑不帶旗標的 `tsc -p`。我只驗前者，漏掉 `composite: true` 會強制 emit 而
   `allowJs` 沒配 `outDir` ⇒ `TS5055` 想把編譯結果寫回原始碼。
   ⚠️ **「跑個檢查指令」不等於唯讀**——那次不帶 `--noEmit` 的重現真的在根目錄寫出了
   `vite.config.js`、`playwright.config.js` 等七個檔案，同名 `.js` 會遮蔽 `.ts`。
   ⚠️ 判涵蓋範圍用 `tsc -p <config> --listFilesOnly`，不要自己 parse tsconfig
   （JSON with comments，`//.*` 這種剝法會把 `/* Bundler mode */` 弄壞）。

---

## 專案概述

StarScope 是一款桌面應用程式，透過速度分析（而非 star 絕對數量）幫助工程師理解 GitHub 專案的發展動能。使用 Tauri v2（Rust + React + Python sidecar）建構。

應用分兩層：**發現層**（Discovery 頁的 For You feed——依使用者興趣清單每日產生個人化推薦）與**監測層**（Watchlist、Trends、Compare、警報——對已追蹤 repo 做時序快照與訊號分析）。監測層的所有功能都依賴發現層或使用者手動把 repo 加入 watchlist，watchlist 為空時整個監測層不會有資料。

```mermaid
graph TB
    T["src-tauri/<br/>Rust · 系統匣 · OS 通知"]
    F["src/<br/>React 19 · Pages · Hooks"]
    B["sidecar/<br/>FastAPI · Services · SQLite"]

    T -->|"WebView 載入"| F
    T ==>|"spawn 並監管進程"| B
    F <-->|"HTTP :8008"| B
    B --> G["GitHub API"]
    B --> H["Hacker News API"]

    classDef rust fill:#ce422b,stroke:#8b2c1d,color:#fff
    classDef web fill:#3b82f6,stroke:#1d4ed8,color:#fff
    classDef py fill:#8b5cf6,stroke:#6d28d9,color:#fff
    classDef ext fill:#475569,stroke:#1e293b,color:#fff
    class T rust
    class F web
    class B py
    class G,H ext
```

⚠️ 圖上那條粗線是重點：**Python sidecar 是 Rust 進程 spawn 出來的子進程**（`src-tauri/src/lib.rs`），
不是獨立服務。App 關掉時它要跟著收——開發時手動起 sidecar 忘了關，下次會直接撞埠。

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

⚠️ **一律走 `sidecar/.venv/`，不要用裸 `python` / `pytest` / `alembic`。**
macOS 內建的 `python3` 是 3.9，而 `constants.py` 與 `db/models.py` 用了 `StrEnum`
（Python 3.11+，共 11 個類別的基底），裸執行會直接 `ImportError: cannot import name 'StrEnum'`。
CI 是綠的，因為 `actions/setup-python` 裝 3.12——**別把 CI 的指令原樣抄到本機**。

```bash
cd sidecar
.venv/bin/python main.py                           # 啟動 FastAPI :8008
.venv/bin/python -m pytest tests/ -v               # 執行所有測試
.venv/bin/python -m pytest tests/test_repos.py -v  # 單一測試檔
.venv/bin/python -m pytest tests/ --cov=.          # 覆蓋率
.venv/bin/alembic upgrade head                     # 資料庫遷移
.venv/bin/ruff check --fix .                       # Python lint（易漏——前端有 husky 擋，Python 沒有）
```

venv 不存在時：`cd sidecar && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`

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

### 完整開發流程

```bash
./start-dev.sh                  # 建議：檢查 venv、清掉佔用 8008 的殘留 process、
                                # trap 訊號時一併關掉 sidecar
```

手動兩個終端機的話要自己記得清 port（上次沒關乾淨會直接撞埠）：

```bash
lsof -ti:8008 | xargs kill -9   # 先清殘留
cd sidecar && .venv/bin/python main.py   # 終端機 1
npm run tauri dev                        # 終端機 2
```

---

## 專案結構

目錄結構用 `ls` 就看得到（README 有完整樹狀圖），這裡只記從名字看不出來的：

- `sidecar/routers/dependencies.py` **不是端點模組**，是 `Depends()` 的共用注入 helper
  ——數路由模組時要扣掉它
- `src-tauri/src/main.rs` 只是進入點，實作全在 `lib.rs`（sidecar 管理、系統匣、視窗控制）
- 前端測試散在各目錄的 `__tests__/`，不是集中一處

---

## 關鍵前端 Hooks

| Hook                     | 說明                                            |
|--------------------------|-----------------------------------------------|
| `useOSNotification`      | OS 層級通知（Tauri notification plugin）— 權限管理、發送通知 |
| `useNotifications`       | 通知中心整合 — 儲存、輪詢、操作、OS 通知整合                     |
| `useNotificationPolling` | 通知輪詢 — 定時取得已觸發警報，偵測新通知並發送 OS 推播               |
| `useImport`              | 批次匯入 — CSV/JSON/TXT 檔案解析、文字貼上                 |
| `useImportExecutor`      | 匯入執行器 — 循序調用 addRepo API、進度追蹤                 |
| `useAlertRules`          | 警報規則管理 — CRUD 操作、手動檢查、表單狀態                    |
| `useFeed`                | For You feed — 當日推薦、空清單自動產生一次、⭐/🚫 回饋           |
| `useInterests`           | 興趣清單與黑名單 CRUD（驅動 feed 的排序來源）                   |

---

## 環境設定

⚠️ **repo 裡有兩份 `.env.example`，用途不同**：

- `sidecar/.env.example` → Python 端（`GITHUB_CLIENT_ID` / `GITHUB_TOKEN` / `PORT` 等）
- 根目錄的 `.env.example` → Vite 端（`VITE_API_URL`）

內容直接 `cat` 該檔，這裡不複製一份免得漂移。不設 token 也能跑，只是 GitHub 配額降到 60/hr。

---

## 測試策略

| 類型     | 工具             | 位置                           |
|--------|----------------|------------------------------|
| 單元測試   | Vitest         | `src/**/__tests__/`          |
| 後端測試   | pytest（非同步）    | `sidecar/tests/`             |
| E2E 測試 | Playwright     | `e2e/`                       |
| CI     | GitHub Actions | `.github/workflows/test.yml` |

### 注意事項

- 重構 hooks 時需同步更新測試 mocks（例：`useWatchlist` → `useWatchlistState` + `useWatchlistActions`）
- 測試單一檔案 - `npx vitest run path/to/file.test.tsx`
- Context Provider 包裹順序 - `WatchlistProvider` 在 `I18nContext` 和 `ThemeContext` 內部
- ⚠️ **jsdom 不處理 CSS**：`toHaveClass("negative")` 對「有對應規則」與「規則根本不存在」
  完全無法區分，顏色／版面類的回歸測試只守得到 class 名那一層。要驗實際外觀得在瀏覽器
  量 `getComputedStyle()`
- E2E selector：**斷言目標**一律用 `data-testid`（class 名會隨改版消失，測試會變成假綠）；
  單純要框出一塊範圍再往裡面找時可以用 class（`page.locator(".alert-rule-form")`）——
  這種用法壞掉時會直接找不到元素而紅，不會靜默通過
- ⚠️ **新增會寫入共用資源的 E2E spec，要加進 `playwright.config.ts` 的 `DB_MUTATING_SPECS`**
  ——那組 spec 只在 chromium 串行跑、用專屬 port 8009/1421 與獨立 DB，
  `reuseExistingServer: false` 是刻意的：否則會接管你正在跑的真實 sidecar，
  把當天 feed 提前消耗掉，而 `seen_repos` 是永久的（推薦過的 repo 不會再出現）

---

## 安全性決策記錄

### CSP `style-src 'unsafe-inline'`

`tauri.conf.json` 中的 CSP 使用 `style-src 'self' 'unsafe-inline'`。此決策的原因：

- **必要性**：Recharts 在 runtime 注入 inline styles，無法避免
- **風險評估**：`unsafe-inline` 僅適用於 `style-src`，`script-src` 並未包含 `unsafe-inline`（這是更關鍵的安全邊界）
- **Desktop 應用環境**：Tauri 應用不暴露於公共網路，XSS 攻擊面遠小於 Web 應用
- **結論**：可接受的 tradeoff。若未來 Recharts 支援 nonce-based CSP，應升級

### API 不使用版本化路徑

桌面應用的前端與後端一起打包發佈（同一個 Tauri binary），版本始終一致，因此 API 不需要 `/api/v1/` 版本前綴。

---

## 後端約定與陷阱

### 資料庫實際位置（最常踩的坑）

SQLite **不在 repo 目錄裡**。路徑由 `db/database.py` 的 `get_app_data_dir()` 決定，優先序：

1. `STARSCOPE_DATA_DIR` 環境變數（測試或自訂路徑）
2. `TAURI_APP_DATA_DIR`（正式環境由 Tauri 注入）
3. `~/.starscope`（開發環境回退）

除錯找資料庫時別在 `sidecar/` 底下找。遷移工具為 Alembic（`sidecar/alembic.ini`）。

### API 回應格式

所有端點回傳統一的 `ApiResponse[T]`：`{success, data, message, error}`。前端 `client.ts` 的 `doFetch` **會自動 unwrap `data` 欄位**，所以前端拿到的是 `data` 的內容而非整個信封——新增端點時若忘了包 `success_response()`，前端會拿到 undefined。

### 服務間依賴

查法：`grep -rn "from services\." sidecar/services/`

⚠️ **頂層 grep 抓不全**——`scheduler.py` 與 `github.py` 有函式內延遲 import 用來迴避循環依賴，
不掃函式體會漏掉。

真正需要記的是扇出規模：`scheduler.py` 是排程樞紐，牽動 **9 個** service
（alerts / anomaly_detector / backup / context_fetcher / feed_generator / github /
release_fetcher / settings / snapshot）。改 alerts 或 anomaly_detector 都會碰到它。

---

## 提交慣例

提交前跑一次（husky 的 pre-commit 只擋 token 外洩與 prettier，不跑型別與測試）：

```bash
npm run lint && npm run format:check && npm run type-check
cd sidecar && .venv/bin/python -m pytest tests/ -q
```

Commit 訊息用 [Conventional Commits](https://www.conventionalcommits.org/)：

| 類型 | 用途 | 範例 |
|---|---|---|
| `feat` | 新功能 | `feat(watchlist): add batch import` |
| `fix` | 修 bug | `fix(scheduler): handle timezone edge case` |
| `docs` | 文件 | `docs: update API endpoint table` |
| `refactor` | 重構 | `refactor: extract logger utility` |
| `test` | 測試 | `test: add coverage for useAsyncFetch` |
| `perf` | 效能 | `perf: memoize expensive calculations` |
| `chore` | 建置／工具 | `chore: bump dependencies` |

程式碼風格：TypeScript 走 Prettier + ESLint（`npm run lint:fix`），Python 走 Ruff（`.venv/bin/ruff check --fix .`）。

---

## 註解與日誌慣例

### 註解

- 一律繁體中文，技術術語保留英文；用語統一「回應」不用「響應」
- 只寫程式碼本身看不出來的約束或原因（why），不重述下一行在做什麼，不寫變更史（「原本」「新增」「取代」「簡化後」句式禁用——改寫成現在式的約束句）
- 檔案頭一律 `/** */`（TS）／`"""docstring"""`（Python）描述模組職責；公開函式配一行說明（與 Python docstring 全覆蓋的立場一致），行內註解只留 why
- **豁免區**（維持原樣，勿翻譯或改寫）：`sidecar/alembic/`（模板產物）、Rust `SAFETY:` 區塊（生態慣例用英文）、`src/test/` 測試基建

### 日誌

- Python：`[模組名] 繁中訊息`，同一模組固定同一個 prefix；middleware 的 `[request_id]` 動態 prefix 是刻意的請求追蹤格式
- 前端：一律走 `utils/logger`（生產環境 no-op），訊息帶 `[元件名]` prefix；唯一例外是 `main.tsx` 的全域 error handler（裸 console，理由見該處註解）
- Rust：不加 bracket prefix（tracing target 已提供模組上下文）

---

## 前端架構模式

### React Query 資料層

- **QueryClient 設定**（`lib/react-query.ts`）— staleTime 5min、gcTime 30min、retry 1
- **queryKeys 工廠** — 型別安全的 query key 生成器，避免魔術字串
- **寫入操作統一由 `WatchlistContext` actions 處理**（addRepo / removeRepo / fetchRepo / refreshAll / recalculateAll），成功後自動 invalidate cache——不要在元件裡直接呼叫 mutation
- **測試工具** — `createTestQueryClient()` 提供零快取零重試的測試用 QueryClient

### 輪詢與計時器（兩個 hook，別選錯）

`hooks/useSmartInterval.ts` 匯出兩個，差別在**暫停的條件**，不是實作細節：

- `useSmartInterval(ms)` — 給 React Query 的 `refetchInterval`。隱藏**或離線**時暫停。
- `useVisibleInterval(cb, ms | false)` — 給顯示用計時器（相對時間、倒數）。**只看可見性**，
  因為倒數與網路無關，離線時該繼續走。恢復可見時會先補跑一次再重啟計時——
  隱藏期間畫面上的值已經過期，只重啟計時的話使用者會盯著一個舊值直到下一次 tick。

⚠️ 唯一刻意不套的地方是 `AppStatusContext` 的 health check：它**必須**在頁面隱藏時繼續跑，
否則偵測不到 sidecar 復活，橫幅會一直掛著。該處有註解說明，不要「順手修正」。

### For You Feed 資料層

- `useFeed()` 回傳 `{ items, feedDate, isLoading, isGenerating, isError, stats, feedback }`
  - `stats` 尚未載到時是 `null`，**不要用 0 佔位**——那會被讀成「真的是 0 次」
  - **自動產生機制**：當日 feed 為空時自動觸發一次 `generateFeed`，用 `autoGenerated` ref 確保每次 mount 至多一次。產生後仍為空（例如興趣清單未設定）不會重試，避免無限迴圈
  - **刻意沒有手動重試按鈕**：feed 一天一批，有內容時後端冪等、無興趣時 `generate_feed` 直接 `return 0`，按了都不會有變化；真正需要重試的「產生失敗」情境，離開頁面再回來就會重新掛載並自動重試
  - `isError` 必須同時涵蓋查詢與產生失敗——generate 掛掉時 query 仍會成功回傳空清單，只看查詢會把 API 失敗誤報成「還沒設定興趣」
- `useInterests()` 的 `create`/`remove` 使用 `mutateAsync` 回傳 Promise，讓呼叫端能依實際結果決定 toast（避免失敗仍顯示成功）
- ⚠️ **`@tanstack/query-core` 5.95.2 的 `mutationFn` 會收到 `(variables, context)` 兩個參數**——直接把單參數的 client 函式當 `mutationFn` 傳入會多收 context。務必包成箭頭函式：`(id) => deleteInterest(id)`

### Watchlist Context + useReducer

- 資料層由 React Query 管理，Context 只負責 UI 狀態
- `LoadingState` 使用 Discriminated Unions 消除不可能狀態
- Context 分層（優化 re-render）：`WatchlistStateContext`（只讀狀態）／ `WatchlistActionsContext`（業務邏輯）
- Selector hooks 精準訂閱：`useSortedFilteredRepos()`、`useLoadingRepo()`、`useIsRefreshing()`、`useIsRecalculating()`
- 測試策略 — Mock Context hooks：`useWatchlistState`、`useWatchlistActions`

### React-Window 虛擬滾動（v2 API，陷阱多）

- **v2 使用 `rowComponent` prop，不是 v1 的 `children` render prop**（版本查 `package.json`，別寫死在這裡）
- `List` 的必填 props 是 `rowComponent`、`rowCount`、`rowHeight`、**`rowProps`**
  ——`style` 是**選填**（型別定義裡有 `?`）。實務上 `style` 要給高度才捲得動，
  但漏掉 `rowProps` 才是唯一會讓 `tsc` 紅字的那個
- ⚠️ `rowComponent` **必須是模組層級的穩定引用**，資料一律走 `rowProps`。
  v2 內部是 `useMemo(() => memo(rowComponent), [rowComponent])`——在元件內定義 row component
  會讓每次 render 整張表重掛
- 動態行高：`rowHeight` 支援 `(index: number) => number`，收合／展開兩種高度定義在 `pages/watchlist/RepoList.tsx`（`COLLAPSED_ITEM_SIZE` / `EXPANDED_ITEM_SIZE`）——**卡片改版時務必同步調整，行高寫死在 JS、CSS 改了不會自動反映**
- 圖表展開狀態由 `RepoList` 層級的 `expandedCharts: Set<number>` 管理
- **避免**：直接傳 `itemData` 到 `List`（改用 `rowProps`）；在 `RowComponent` 中用 inline arrow 當 memoized 子元件的 callback（會破壞 `RepoCard` 的 `memo`）——`onChartToggle` 因此設計成接受 `(repoId: number)` 參數
