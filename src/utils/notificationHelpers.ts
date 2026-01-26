import { TriggeredAlert } from "../api/client";
import { Notification } from "../hooks/useNotifications";

/**
 * Convert triggered alerts to notifications.
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
 * Sort notifications by timestamp (newest first).
 */
export function sortNotifications(notifications: Notification[]): Notification[] {
  return notifications.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/**
 * Merge new notifications with existing ones, preserving local read status.
 */
export function mergeNotifications(
  newNotifications: Notification[],
  existingNotifications: Notification[]
): Notification[] {
  const prevReadIds = new Set(existingNotifications.filter((n) => n.read).map((n) => n.id));

  return newNotifications.map((notification) => ({
    ...notification,
    // Preserve local read status if it was marked read locally but not yet on server
    read: notification.read || prevReadIds.has(notification.id),
  }));
}
