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
