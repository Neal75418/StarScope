/**
 * API 相關常數 — 分頁大小、限制值與輪詢設定。
 */

/** GitHub 搜尋結果的預設分頁大小（與 GitHub API 預設值一致）。 */
export const GITHUB_SEARCH_PAGE_SIZE = 30;

/** 趨勢 API 請求的預設上限。 */
export const TRENDS_DEFAULT_LIMIT = 50;

/** OAuth Device Flow 的最小輪詢間隔（秒）。 */
export const DEVICE_FLOW_MIN_POLL_INTERVAL_SEC = 10;

/** GitHub 回傳 slow_down 時額外增加的秒數。 */
export const DEVICE_FLOW_SLOWDOWN_EXTRA_SEC = 5;

/** 首次 Device Flow 輪詢前的初始延遲（毫秒）。 */
export const DEVICE_FLOW_INITIAL_DELAY_MS = 3000;

/** 剪貼簿操作後顯示「已複製」回饋的持續時間（毫秒）。 */
export const CLIPBOARD_FEEDBACK_MS = 2000;

/** 預設請求逾時時間（毫秒）。30 秒適用於大部分端點。 */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * 全量抓取的逾時。94 個 repo 實測 43.3 秒，遠超過預設的 30 秒。
 * 拉長不是為了讓 UI 知道結果——結果一律讀 diagnostics 的 fetch_in_progress——
 * 而是避免客戶端 abort 把伺服器跑到一半的抓取砍掉。
 * 若哪天逼近這個值，正解是後端改成「收下工作立刻回 202」，不是再把數字調大。
 */
export const FETCH_ALL_TIMEOUT_MS = 300_000;

/** API 呼叫最大重試次數（不含首次請求）。 */
export const MAX_RETRIES = 2;

/** 重試間的基本延遲（毫秒），配合指數退避使用。 */
export const RETRY_DELAY_MS = 500;

/** 警報列表查詢的預設上限。 */
export const ALERT_FETCH_LIMIT = 50;

/** Discovery 搜尋的期間天數。 */
export const DISCOVERY_PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 30, yearly: 365 } as const;

/** Discovery 搜尋各期間的最低星數門檻。 */
export const DISCOVERY_PERIOD_MIN_STARS = {
  daily: 10,
  weekly: 50,
  monthly: 100,
  yearly: 500,
} as const;

/** API 錯誤訊息常量，統一管理硬編碼字串。 */
export const API_ERROR_MESSAGES = {
  CANCELLED: "Request cancelled",
  TIMED_OUT: "Request timed out",
  UNKNOWN_ERROR: "Unknown error",
  REQUEST_FAILED: "API request failed",
  RETRIES_EXHAUSTED: "Request failed after retries",
} as const;
