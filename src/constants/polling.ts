/**
 * 輪詢設定常量。
 */

import { MS_PER_MINUTE } from "../utils/format";

/** 通知輪詢間隔（毫秒）。每分鐘檢查一次已觸發的警報。 */
export const NOTIFICATION_POLL_INTERVAL_MS = MS_PER_MINUTE;

/** 每次輪詢最多發送的 OS 通知數量，避免轟炸使用者。 */
export const MAX_OS_NOTIFICATIONS_PER_POLL = 3;
