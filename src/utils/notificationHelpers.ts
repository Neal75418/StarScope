/**
 * 通知轉換與合併輔助函式。
 * 將已觸發警報轉為通知格式，並管理已讀狀態合併。
 *
 * 警報的已讀與清除以後端為準（acknowledged_at、dismissed_at，後端本身就持久）。本機只在記憶體記這次開 app
 * 標成已讀、清除過的通知（LocalMarks），撐過確認回來之前的那段時間。
 */

import type { TriggeredAlert } from "../api/client";
import type { Notification } from "../hooks/useNotifications";
import { getSignalDisplayName } from "./signalTypeHelpers";

/**
 * 這次開 app 做過、沒有失敗的標記（請求還在路上，或已經成功）。失敗或對象已經不在時拿掉。
 * 成功的留著：輪詢可能讀回請求之前送出的結果；後端確認、清除過的不會再變回來，留著也不會讓畫面錯。
 */
export interface LocalMarks {
  /** 標成已讀的 */
  reads: Set<string>;
  /** 清除的：鈴鐺不再顯示 */
  dismissals: Set<string>;
}

/**
 * 將已觸發的警報轉換為通知。通知的識別帶觸發時間：觸發紀錄的 id 會重用，只看 id 會把拿到同一個 id 的新警報
 * 當成同一則（沿用已讀、不發系統通知）。觸發時間用原字串，不解析
 */
export function alertsToNotifications(
  alerts: TriggeredAlert[],
  signalLabels?: Record<string, string>
): Notification[] {
  return alerts.map((alert) => {
    const id = `alert-${alert.id}-${alert.triggered_at}`;
    const signalName = signalLabels
      ? getSignalDisplayName(alert.signal_type, signalLabels)
      : alert.signal_type;
    return {
      id,
      type: "alert" as const,
      title: alert.rule_name,
      message: `${alert.repo_name}: ${signalName} ${alert.operator} ${alert.threshold} (${(alert.signal_value ?? 0).toFixed(1)})`,
      timestamp: alert.triggered_at,
      read: alert.acknowledged_at !== null,
      link: {
        page: "watchlist" as const,
        params: { repo: alert.repo_name },
      },
      metadata: {
        repoName: alert.repo_name,
        signalType: alert.signal_type,
        alertId: alert.id,
        triggeredAt: alert.triggered_at,
      },
    };
  });
}

/**
 * 依時間戳排序通知（最新的在前）。
 */
export function sortNotifications(notifications: Notification[]): Notification[] {
  return [...notifications].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/**
 * 以後端讀回的通知為準，再套上這次開 app 的標記：清除過的不顯示、標成已讀的顯示已讀。
 * 不沿用畫面上原本的樣子：標已讀失敗後讀回來的未讀要照實顯示
 */
export function mergeNotifications(fromServer: Notification[], marks: LocalMarks): Notification[] {
  return fromServer
    .filter((notification) => !marks.dismissals.has(notification.id))
    .map((notification) => ({
      ...notification,
      read: notification.read || marks.reads.has(notification.id),
    }));
}
