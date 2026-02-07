# 變更日誌

本檔案記錄 StarScope 所有值得注意的變更。

格式依據 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
版本號遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

---

## [Unreleased]

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

### 效能優化

- 修正 N+1 查詢，新增 React `useMemo` / `useCallback` 記憶化
- 新增 API 回應快取、排程器 checkpoint、分頁載入
- CSS 渲染優化與 context signal 清理
- 全面效能調校與程式碼品質提升

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

[Unreleased]: https://github.com/Neal75418/StarScope/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Neal75418/StarScope/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Neal75418/StarScope/releases/tag/v0.1.0
