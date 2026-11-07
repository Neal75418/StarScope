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
 * 全量抓取的逾時。逐一抓取的實作（2026-08）94 個 repo 實測 43.3 秒，遠超過預設的 30 秒。
 * 前端逾時放棄並不會讓伺服器停下（uvicorn 不會因 client 斷線取消 handler）：太短的話抓取照樣跑完，
 * 前端卻拿不到成功／失敗數（部分失敗的提示就靠它），使用者還以為失敗了。
 * 若哪天逼近這個值，正解是後端改成「收下工作立刻回 202」，不是再把數字調大。
 */
export const FETCH_ALL_TIMEOUT_MS = 300_000;

/**
 * 批次加入的逾時。最多 100 筆，有 token 時每筆先在 GitHub 加星再讀回 repo；加星遇到次級限流時依
 * Retry-After 退避，每次最多一分鐘。批次加入是逐筆做的；逐一抓取的全量抓取每筆也是一兩次 GitHub 請求，
 * 94 筆實測 43.3 秒，所以筆數多時 30 秒做不完。理由同 FETCH_ALL_TIMEOUT_MS：提早放棄只會讓前端顯示失敗，伺服器照樣把它做完。
 */
export const BATCH_ADD_TIMEOUT_MS = 300_000;

/**
 * 批次加入逾時後，每隔多久重抓一次追蹤清單；持續 BATCH_ADD_TIMEOUT_MS（給伺服器的時間和請求本身一樣長）。
 * 逾時當下伺服器還在逐筆加入，而 repos 查詢 5 分鐘內視為新鮮、切頁也不會重抓，只抓一次會停在做到一半的名單。
 */
export const BATCH_ADD_FOLLOWUP_INTERVAL_MS = 30_000;

/** GET 與唯讀查詢的最大重試次數（不含首次請求）；寫入預設不重試，見 client.ts 的 ApiCallConfig。 */
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
