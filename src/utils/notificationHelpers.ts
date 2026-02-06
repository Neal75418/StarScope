import { TriggeredAlert } from "../api/client";
import { Notification } from "../hooks/useNotifications";

/**
 * 將已觸發的警報轉換為通知。
 */
export function alertsToNotifications(
  alerts: TriggeredAlert[],
  readIds: Set<string>
): Notification[] {
  return alerts.map((alert) => {
    const id = `alert-${alert.id}`;
    return {
      id,
      type: "alert" as const,
      title: alert.rule_name,
      message: `${alert.repo_name}: ${alert.signal_type} ${alert.operator} ${alert.threshold} (current: ${alert.signal_value.toFixed(1)})`,
      timestamp: alert.triggered_at,
      read: readIds.has(id) || alert.acknowledged_at !== null,
      link: {
        page: "watchlist" as const,
        params: { repo: alert.repo_name },
      },
      metadata: {
        repoName: alert.repo_name,
        signalType: alert.signal_type,
        alertId: alert.id,
      },
    };
  });
}

/**
 * 依時間戳排序通知（最新的在前）。
 */
export function sortNotifications(notifications: Notification[]): Notification[] {
  return notifications.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/**
 * 合併新通知與現有通知，保留本地已讀狀態。
 */
export function mergeNotifications(
  newNotifications: Notification[],
  existingNotifications: Notification[]
): Notification[] {
  const prevReadIds = new Set(existingNotifications.filter((n) => n.read).map((n) => n.id));

  return newNotifications.map((notification) => ({
    ...notification,
    // 保留本地已讀狀態（本地標為已讀但尚未同步至伺服器）
    read: notification.read || prevReadIds.has(notification.id),
  }));
}
