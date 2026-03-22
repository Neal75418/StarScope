# StarScope 工程規約

> 專案核心工程約定，所有貢獻者應遵守。

---

## Polling 規則

- 所有 polling 必須 **visibility-aware + offline-aware**
- React Query 場景：使用 `useSmartInterval` 作為 `refetchInterval`
- 原生 setInterval 場景：使用 `useSmartIntervalCallback`
- 頁面不可見或離線時自動暫停輪詢

## 錯誤處理規則

- 所有 API 錯誤使用 `ApiError` class（含 `code`/`details` 結構化欄位）
- 5 種降級等級：`online` / `offline` / `sidecar-down` / `rate-limited` / `partial-failure`
- 頁面透過 `useAppStatus()` 取得全域降級狀態
- 429 重試耗盡時 `apiCall` 自動廣播 `starscope:rate-limited` 事件
- retry backoff 可被 `AbortSignal` 取消，abort 時回傳 `CANCELLED`

## 背景任務規則

- 所有 background task 必須可取消（`cancel` + `await`）
- shutdown 順序：`stop_scheduler()` → `await startup_task` → `close_github_service()`
- 不允許 unhandled background exception

## 測試規則

- 所有新狀態流程必須有至少一層測試（unit 或 E2E）
- E2E selector 使用 `data-testid`，不使用 CSS class 或 `id`
- 避免 `waitForTimeout`（使用 `toBeVisible` / `toBeEnabled` 等 deterministic wait）
- 避免 hardcoded 版本號或環境特定值

## 型別規則

- 前後端型別透過 `npm run check:api-drift` 驗證同步
- Bundle 透過 `npm run check:bundle-size` 保持在 400KB gzipped 以內
- Coverage 門檻：80%（lines/functions/branches/statements）

## 代碼風格

- 註解語言：繁體中文（技術術語保留英文）
- Catch 變數：`catch (err)`（前端）/ `except ... as e`（後端）
- Logger prefix：`[模組名]` 格式
- Import 順序：stdlib → third-party → local
