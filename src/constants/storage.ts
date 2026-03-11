/**
 * 集中管理 localStorage 儲存鍵值，避免散落各處。
 */

export const STORAGE_KEYS = {
  COMPARE_REPOS: "starscope-compare-repos",
  DISMISSED_RECS: "starscope_dismissed_recs",
  NOTIFICATIONS_READ: "starscope_notifications_read",
  SAVED_FILTERS: "starscope_saved_filters",
  SEARCH_HISTORY: "starscope_search_history",
} as const;
