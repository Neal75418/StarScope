/**
 * 集中管理 localStorage 儲存鍵值，避免散落各處。
 */

// 注意：COMPARE_REPOS、LANGUAGE、PAGE、THEME 使用 hyphen 分隔符（歷史遺留），
// 其餘使用 underscore。因已寫入使用者 localStorage，無法統一。新增 key 一律用 underscore。
export const STORAGE_KEYS = {
  COMPARE_REPOS: "starscope-compare-repos",
  DISMISSED_RECS: "starscope_dismissed_recs",
  LANGUAGE: "starscope-language",
  // 舊版記在本機的通知已讀 id：現在警報的已讀只看後端、不再讀寫它。重設資料時一併清掉殘留；
  // 不在啟動時刪：共用 localStorage 的舊版安裝檔還在用
  NOTIFICATIONS_READ: "starscope_notifications_read",
  PAGE: "starscope-page",
  SAVED_FILTERS: "starscope_saved_filters",
  SEARCH_HISTORY: "starscope_search_history",
  RECENTLY_VIEWED: "starscope_recently_viewed",
  THEME: "starscope-theme",
  VIEW_MODE: "starscope_view_mode",
  WATCHLIST_SORT: "starscope_watchlist_sort",
  WATCHLIST_VIEW_MODE: "starscope_watchlist_view_mode",
  WATCHLIST_SUMMARY_COLLAPSED: "starscope_watchlist_summary_collapsed",
  TRENDS_VIEW_MODE: "starscope_trends_view_mode",
  TRENDS_AUTO_REFRESH: "starscope_trends_auto_refresh",
} as const;
