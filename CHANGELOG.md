# 變更日誌

本檔案記錄 StarScope 所有值得注意的變更。

格式依據 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
版本號遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

---

## [Unreleased]

### 新增功能

- **OS 層級推播通知** — 警報觸發時透過 Tauri notification plugin 發送系統通知
- **虛擬滾動** — 使用 react-window v2 實現 Watchlist 視窗化載入，大幅提升大量資料渲染效能
- **React Query 資料層遷移** — 三階段遷移至 React Query v5，取代手動 fetch 邏輯
- **統一 API 回應格式** — 全部端點遷移至 `ApiResponse[T]` 統一格式
- **9 項核心改進** — 安全性、效能、架構全面提升

### 重構與變更

- **Critical/High 問題修復** — Stage 1-3 共修復 20 個 Critical/High 優先級問題（依賴注入、異常處理、型別提示、元件拆分、函數分解）
- **Watchlist 架構升級** — 遷移至 Context + useReducer 模式
- **前端結構重構** — Watchlist.tsx 元件拆分（484→355 行）、RepoCard Props 優化（10→6 個）
- **後端結構重構** — 拆分過長函數（recommender / scheduler / context_fetcher / anomaly_detector）
- **補充 Response Model** — 改善 Export 端點的 OpenAPI 文件完整性
- **過度設計移除** — 清除過度導出、未使用程式碼、冗餘文件，淨減 881+ 行
- **程式碼品質** — 修復 17 項 code smell、統一 Page 型別、inline hooks 簡化

### 問題修正

- 修復 Export 測試斷言錯誤（mock_repo fixture 值不匹配）
- 修復月初觸發的測試失敗（時間敏感 bug：`date.today().replace(day=1)` 在月初等於今日）
- 修復 React Hooks 依賴警告（CI lint 錯誤）
- 修復 Dashboard 因 queryFn 資料結構不一致導致 repos 為空
- 修復虛擬滾動中圖表展開被裁切的問題
- 修復滾動時圖表不必要的重新渲染
- 修復 CommitActivityBadge 載入後無法點擊的問題
- 修復 APScheduler backup_job 序列化錯誤導致啟動失敗
- 修復第一批 API 遷移的響應結構不匹配導致前端分頁全部壞掉
- 修復分頁排序不確定性與通知輪詢背景浪費
- 修復 Watchlist 頁面無限 API 請求循環問題
- 修復 scheduler rate limit 與 DiscoverySearchBar 狀態同步
- 修復 useMemo 依賴陣列引用穩定性（ESLint exhaustive-deps）
- 修復 ESLint 警告 — cleanup 函數中的 ref 訪問
- 修復 mypy 型別檢查錯誤
- 修復 mockI18n 循環依賴導致 vitest 死鎖
- 全面修復 race condition、效能、穩健性、a11y

### 效能優化

- 消除重複 API 請求、優化 recentActivity 與虛擬滾動

### 測試

- Export 測試覆蓋擴充：15 行 → 569 行，1 → 18 個測試（JSON/CSV/批次查詢優化）
- 修復 early_signals 相關的 mock 測試

### 文件

- 同步文件與程式碼現狀

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

[Unreleased]: https://github.com/Neal75418/StarScope/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Neal75418/StarScope/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Neal75418/StarScope/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Neal75418/StarScope/releases/tag/v0.1.0
