# 變更日誌

本檔案記錄 StarScope 所有值得注意的變更。

格式依據 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
版本號遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

---

## [Unreleased]

### 修復

- **並發安全** — close_github_service 加鎖防 double-close、scheduler health/failure counts 加 threading.Lock、alerts 改為 per-alert commit 防 rollback 連鎖失效
- **安全** — isSafeUrl 封鎖完整私有 IPv4/IPv6 範圍、logging middleware 遮蔽 X-Session-Secret、403 區分 rate limit vs forbidden
- **正確性** — formatChartDate/formatXDate/WeeklySummary 統一 UTC 日期方法、get_thresholds 異常 fallback、stop_scheduler async 防 deadlock、threshold 原子更新、repos 新增時填入 topics
- **功能補全** — Tray "Refresh All" 接入前端、import round-trip 支援 StarScope 自身匯出格式、alert rules 暴露全部 9 個 signal types
- **死碼清理** — 移除 release_surge 前端 stub、ApiError 未用 getter、types.generated.ts、空 react-vendor chunk

### 測試

- **E2E 擴展** — 新增 5 個 spec（Dashboard、Compare、Categories、Alerts、Import/Export），E2E 從 6→11 specs / 24→47 tests
- **單元測試** — 新增 import round-trip、IPv6、cooldown、stale response 等 15+ 測試案例

---

## [0.4.1] — 2026-03-25

### 重構與變更

- **功能瘦身** — 移除 ~10,000 行過度設計的功能（Similar Repos、Commit Activity、Languages Panel、Compare 7 個子功能、Saved Filters、Search History、Recently Viewed 等），聚焦核心價值
- **CSS 技術債清理** — 移除 1,500+ 行死碼（App.css + Discovery.module.css），修復 4 個未定義 CSS 變數（`--accent-primary`、`--color-danger`、`--done-subtle`、`--done-fg`），消除所有多餘 `var()` fallback
- **Section comment 風格統一** — CSS 15 處 + TS 19 處裝飾式註解統一為簡潔格式
- **Orphan comment 清理** — 移除功能瘦身後殘留的 7 個空 section 註解
- **Husky v9 適配** — 移除 deprecated `. husky.sh` sourcing，修復 `core.hooksPath` 錯誤配置
- **Python 死碼清理** — 移除未使用的 `ErrorCode` schema、`pandas` 依賴（~30MB）
- **日誌語言統一** — database.py 英文日誌改為繁體中文，query logger INFO → DEBUG 降噪
- **代碼風格統一（7 輪 review）** — 101 處修復：英文 comment/docstring 全面翻譯為繁中、`catch (err)` / `except as e` 統一、import 順序標準化、logger `[模組名]` prefix 補齊、`%` formatting → f-string、PEP 8 blank lines

### 新增功能

- **統一降級策略** — AppStatusContext 統一管理 online/offline/sidecar-down/rate-limited 四種降級狀態
- **StatusBanner** — 全域降級狀態橫幅（離線、sidecar 不可用時自動顯示），支援暗色/淺色主題
- **DataFreshnessBar** — 資料新鮮度指示條（最後更新時間、離線狀態、同步中、手動刷新）
- **Settings Diagnostics** — 系統診斷區塊（版本、運行時間、DB 大小/路徑、repo/快照數、最後同步）
- **結構化 API 錯誤碼** — ApiError 擴展 code/details + isRateLimited/isNotFound/isRetryable 判斷
- **Bundle budget** — 400KB gzipped JS 預算 + CI 自動檢查（當前 330KB）
- **OpenAPI 型別整合** — generate:types + check:api-drift 前後端型別同步檢測
- **統一 polling** — useSmartInterval（visibility + online aware），統一通知與 Device Flow 輪詢
- **API retry abort-aware** — 退避延遲可被 AbortSignal 取消，abort 時回傳 CANCELLED 而非 stale error

### 問題修正

- 修復 Discovery filter-only 搜尋不觸發 API 請求（hasActiveFilters + stars:>=0 fallback）
- 修復 Discovery 分頁失敗覆蓋已載入結果（totalCount 取 firstPage、error 僅在 repos 為空時顯示）
- 修復 Sidecar shutdown race condition（先停排程器再關閉 HTTP client）
- 修復 API retry backoff 期間 abort 回傳 stale error 而非 CANCELLED
- 修復 `close_github_service` 並發 double-close 問題（加鎖保護）
- 修復 `_scheduler_health` / `_repo_failure_counts` 線程安全問題
- 修復 `formatChartDate` 非 UTC 時區回傳錯誤日期（改用 getUTCMonth/getUTCDate）
- 修復 `useAlertRuleOperations.handleToggle` stale closure 問題（改用 useRef）
- 修復 `useWindowedBatchRepoData` 競態條件（per-effect ownedIds + AbortController）
- 修復 `isSafeUrl` 未封鎖完整私有 IP 範圍（127.x、10.x、192.168.x 等）
- 修復 `get_thresholds` 異常時未 fallback 到預設值

- 修復 SQLAlchemy SAWarning：`subquery()` → `select()` 消除 "Coercing Subquery" 警告
- 修復 `utc_now()` 時區一致性：回傳 naive datetime 消除 aware/naive 不匹配
- 修復 6 個 hardcoded `#fff`/`#ffffff` → `var(--fg-on-emphasis)` 確保主題一致性
- 修復 `btn-outline`/`btn-ghost` CSS 定義缺失（TSX 使用但 CSS 無對應樣式）
- 修復 `index.html` Vite 預設值：favicon → StarScope icon、title → "StarScope"

### 效能優化

- **N+1 查詢消除** — alerts、analyzer、anomaly_detector、recommender 全面批次預載
- **資料庫索引** — 新增 3 個索引（alert_rules_repo_id、triggered_alerts_ack_time、early_signals_active）
- **CI 加速** — 3 jobs 平行化，CI 時間 3m23s → 2m12s（-34%）

### 測試

- **E2E 測試** — 11 個 Playwright spec / 47 個測試案例（導航、Watchlist、Discovery、Dashboard、Compare、Categories、Alerts、Import/Export）
- **覆蓋率補強與品質提升** — 5 輪測試品質審查，移除低價值測試、強化斷言、修復 flaky patterns，當前 1,208 前端 + 471 後端 = 1,679 個測試

### 文件

- README.md、CLAUDE.md、CONTRIBUTING.md 同步至實際代碼結構
- package.json 補充 description、license、author、repository 欄位

---

## [0.4.0] — 2026-03-12

### 新增功能

- **週報摘要** — Dashboard 一週概覽：漲跌幅排行、信號、HN 提及
- **多 Repo 對比** — 星數趨勢、指標並排比較
- **個人化推薦** — 基於 topics + language 的相似 repo 推薦
- **OS 層級推播通知** — 警報觸發時透過 Tauri notification plugin 發送系統通知
- **虛擬滾動** — 使用 react-window v2 實現 Watchlist 視窗化載入，大幅提升大量資料渲染效能
- **React Query 資料層遷移** — 三階段遷移至 React Query v5，取代手動 fetch 邏輯
- **統一 API 回應格式** — 全部 67 個端點遷移至 `ApiResponse[T]` 統一格式
- **Discovery 頁面強化** — 六項功能改善（搜尋、篩選、排序等）

### 重構與變更

- **Watchlist 架構升級** — 遷移至 Context + useReducer 模式，Context 分層優化 re-render
- **前端結構重構** — Watchlist.tsx 元件拆分（484→355 行）、RepoCard Props 優化（10→6 個）
- **後端結構重構** — 拆分過長函數（recommender / scheduler / context_fetcher / anomaly_detector）
- **Critical/High 問題修復** — Stage 1-3 共修復 20 個 Critical/High 優先級問題
- **過度設計移除** — 清除過度導出、未使用程式碼、冗餘文件，淨減 881+ 行
- **CSS 設計系統標準化** — 統一設計 token、顏色變數、間距系統
- **全面代碼衛生清理** — 死碼移除、i18n 遷移、連線池化、hooks 穩定性
- **Python 現代語法升級** — `typing.List/Dict/Optional` → `list/dict/X | None`（36 檔案）
- **繁中註解統一** — Rust/前端/後端所有英文註解、JSDoc、日誌訊息改為繁體中文
- **前端代碼風格統一** — `memo()` 具名函式、`catch (err)` 統一、named export、section separator 統一
- **Tauri notification 權限** — 補齊 `notification:default` capabilities 宣告

### 問題修正

- 修復 Dashboard 因 queryFn 資料結構不一致導致 repos 為空
- 修復虛擬滾動中圖表展開被裁切的問題
- 修復滾動時圖表不必要的重新渲染
- 修復 APScheduler backup_job 序列化錯誤導致啟動失敗
- 修復第一批 API 遷移的響應結構不匹配導致前端分頁全部壞掉
- 修復分頁排序不確定性與通知輪詢背景浪費
- 修復 Watchlist 頁面無限 API 請求循環問題
- 修復 scheduler rate limit 與 DiscoverySearchBar 狀態同步
- 修復 useMemo 依賴陣列引用穩定性（ESLint exhaustive-deps）
- 修復 mockI18n 循環依賴導致 vitest 死鎖
- 修復 mypy 32 項型別錯誤
- 全面修復 race condition、效能、穩健性、a11y

### 效能優化

- 消除重複 API 請求、優化 recentActivity 與虛擬滾動
- AbortController 取消過期請求、React.memo 細粒度 memoization
- CSS Module 遷移（Discovery 頁面）

### 測試

- 前端 870 + 後端 482 = **1,352 個測試案例**（較 v0.3.0 的 672 個翻倍）
- 126 項安全性相關新測試
- Export 測試覆蓋擴充：15 行 → 569 行，1 → 18 個測試

### CI/CD

- CI concurrency 控制、動態 build matrix（PR 僅跑 ubuntu）、timeout 防護
- `actions/upload-artifact` v4 → v7
- Workflow step name 統一
- npm 依賴升級（framer-motion、recharts、prettier、typescript-eslint、vite）
- pip 依賴加入 upper bound 防止意外 breaking 升級
- npm audit 漏洞修復（0 vulnerabilities）

### 文件

- CLAUDE.md 與 README.md 同步至實際代碼結構
- 移除過時的 `.agent/skills/` 目錄

---

## [0.3.0] — 2026-02-09

### 新增功能

- **ContextBadges 元件強化** — 改善徽章樣式與互動體驗
- **UI/UX 全面打磨** — 修正版面配置，提升整體視覺一致性

### 重構與變更

- **統一前端日誌系統** — 以集中式 `logger`（`error` / `warn` / `info`）取代 31 處散落的 `console` 呼叫，production 環境自動靜默
- **產品精簡** — 移除 Signals 頁面，聚焦核心功能
- **ESLint `no-console` 升級為 `"error"`** — 從源頭防止未來誤用 `console`

### 問題修正

- 修正排程器 naive / aware datetime 比較問題
- 以 Tauri `openUrl` 取代失效的外部連結
- 修正警報排程邏輯，避免記錄敏感資料
- P0 程式碼審查修正與排程器改進
- 修正 early_signals severity 字串排序錯誤（改用 CASE expression）
- 收窄 Tauri shell:allow-spawn 為 sidecar-only scope

### 效能優化

- 修正 N+1 查詢，新增 React `useMemo` / `useCallback` 記憶化
- 新增 API 回應快取、排程器 checkpoint、分頁載入
- CSS 渲染優化與 context signal 清理
- 全面效能調校與程式碼品質提升
- 修正 categories、star_history 的 N+1 / 批次查詢問題

### 測試

- 新增約 233 個測試（涵蓋 27 個檔案），大幅擴展覆蓋範圍
- 分支覆蓋率突破 80% CI 門檻（共 672 個測試，86%+ 分支覆蓋率）

---

## [0.2.0] — 2026-01-26

### 新增功能

- **Star 歷史圖表** — 視覺化追蹤星星數變化趨勢
- **Commit 活動面板** — 展示 Repo 近期提交頻率
- 新增單元測試，搭配 i18n mock 提升覆蓋率

### 重構與變更

- 統一日誌輸出風格，精簡文件說明
- 完成第五輪程式碼品質與效能優化

### 問題修正

- 修正 CI 測試失敗與 `CategoryTreeNode` mock 型別
- 修正 Prettier 格式問題

### CI/CD

- 新增全平台 sidecar 建置步驟
- 納入 PyInstaller spec 檔案以支援 sidecar 打包

---

## [0.1.0] — 2026-01-20

### 新增功能

- **專案初始化** — Tauri v2 + React + TypeScript 前端架構
- **Phase 1 MVP** — GitHub Star 管理、Repository 瀏覽與搜尋
- **Phase 2** — 排程監控、警報通知、系統匣、趨勢分析
- **GitHub Device Flow 認證** — 安全的 OAuth 裝置授權流程
- **國際化 (i18n) 與主題系統** — 中英切換、淺色/深色模式
- **前端單元測試** — 263 個測試，81.73% 覆蓋率
- **CI/CD 流水線** — 自動化測試與建置
- **E2E 測試基礎建設** — 採用 `data-testid` 選擇器
- **架構文件** — Mermaid 圖表呈現系統架構
- **ESLint + Prettier** — 統一程式碼風格

### 問題修正

- 規避 macOS 26 全螢幕按鈕崩潰問題
- 修正 sidecar 測試設定與 async/await 錯誤
- 清理前端與 sidecar IDE 警告
- 修正 TypeScript 編譯錯誤

---

[Unreleased]: https://github.com/Neal75418/StarScope/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/Neal75418/StarScope/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Neal75418/StarScope/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Neal75418/StarScope/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Neal75418/StarScope/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Neal75418/StarScope/releases/tag/v0.1.0
