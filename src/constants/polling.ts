/**
 * 輪詢設定常量。
 */

import { MS_PER_MINUTE } from "../utils/format";

/** 通知輪詢間隔（毫秒）。每分鐘檢查一次已觸發的警報。 */
export const NOTIFICATION_POLL_INTERVAL_MS = MS_PER_MINUTE;

/** 每次輪詢最多發送的 OS 通知數量，避免轟炸使用者。 */
export const MAX_OS_NOTIFICATIONS_PER_POLL = 3;

/** 背景星標同步與抓取的檢查間隔（毫秒）。sidecar 啟動時與 launchd 收集器的同步、排程與收集器的抓取都不會通知前端，只能輪詢。 */
export const STAR_SYNC_POLL_INTERVAL_MS = MS_PER_MINUTE;

/**
 * 回填區塊顯示離線時，多久再看一次回填狀態。回填狀態的端點連不上、但健康檢查一直答得出來時，
 * onlineManager 不會離線、也就等不到「重新連上」；真的離線時 React Query 會暫停這個輪詢，一個請求都不發
 */
export const BACKFILL_OFFLINE_RECHECK_MS = 10_000;
