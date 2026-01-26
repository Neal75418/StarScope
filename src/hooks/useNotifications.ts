/**
 * Hook for managing in-app notifications.
 * Aggregates alerts, signals, and system events into a unified notification feed.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { listTriggeredAlerts, TriggeredAlert, acknowledgeTriggeredAlert } from "../api/client";

export type NotificationType = "alert" | "signal" | "system";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  link?: {
    page: "watchlist" | "signals" | "settings";
    params?: Record<string, string>;
  };
  metadata?: {
    repoName?: string;
    signalType?: string;
    alertId?: number;
  };
}

const STORAGE_KEY = "starscope_notifications_read";
const POLL_INTERVAL = 60000; // 1 minute

/**
 * Load read notification IDs from localStorage.
 */
function loadReadIds(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      return new Set(parsed);
    }
  } catch (err) {
    console.warn("Failed to load notification read IDs:", err);
  }
  return new Set();
}

/**
 * Save read notification IDs to localStorage.
 */
function saveReadIds(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch (err) {
    console.warn("Failed to save notification read IDs:", err);
  }
}

/**
 * Convert triggered alerts to notifications.
 */
function alertsToNotifications(
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

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const readIdsRef = useRef<Set<string>>(loadReadIds());
  const pollIntervalRef = useRef<number | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      // Fetch unacknowledged alerts (primary source of notifications)
      const alerts = await listTriggeredAlerts(false, 50);

      // Convert to notifications
      const alertNotifications = alertsToNotifications(alerts, readIdsRef.current);

      // Sort by timestamp (newest first)
      const sorted = alertNotifications.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      // Merge with existing state to preserve local read status
      setNotifications((prev) => {
        const prevReadIds = new Set(prev.filter((n) => n.read).map((n) => n.id));

        return sorted.map((notification) => ({
          ...notification,
          // Preserve local read status if it was marked read
          read: notification.read || prevReadIds.has(notification.id),
        }));
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch notifications");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  // Polling
  useEffect(() => {
    pollIntervalRef.current = window.setInterval(() => {
      void fetchNotifications();
    }, POLL_INTERVAL);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [fetchNotifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = useCallback(async (notificationId: string) => {
    readIdsRef.current.add(notificationId);
    saveReadIds(readIdsRef.current);

    // Update local state and get the notification to acknowledge
    let alertIdToAcknowledge: number | undefined;

    setNotifications((prev) => {
      const notification = prev.find((n) => n.id === notificationId);
      if (notification?.type === "alert" && notification.metadata?.alertId) {
        alertIdToAcknowledge = notification.metadata.alertId;
      }
      return prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n));
    });

    // Acknowledge on server if it's an alert
    if (alertIdToAcknowledge) {
      try {
        await acknowledgeTriggeredAlert(alertIdToAcknowledge);
      } catch (err) {
        console.warn(`Failed to acknowledge alert ${alertIdToAcknowledge}:`, err);
      }
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    // Collect alert IDs and update state
    const alertIdsToAcknowledge: number[] = [];

    setNotifications((prev) => {
      prev.forEach((n) => {
        readIdsRef.current.add(n.id);
        if (n.type === "alert" && !n.read && n.metadata?.alertId) {
          alertIdsToAcknowledge.push(n.metadata.alertId);
        }
      });
      saveReadIds(readIdsRef.current);
      return prev.map((n) => ({ ...n, read: true }));
    });

    // Acknowledge all on server
    for (const alertId of alertIdsToAcknowledge) {
      try {
        await acknowledgeTriggeredAlert(alertId);
      } catch (err) {
        console.warn(`Failed to acknowledge alert ${alertId}:`, err);
      }
    }
  }, []);

  const clearNotification = useCallback((notificationId: string) => {
    readIdsRef.current.add(notificationId);
    saveReadIds(readIdsRef.current);
    setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
  }, []);

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchNotifications();
  }, [fetchNotifications]);

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
    isOpen,
    toggleOpen,
    close,
    markAsRead,
    markAllAsRead,
    clearNotification,
    refresh,
  };
}
