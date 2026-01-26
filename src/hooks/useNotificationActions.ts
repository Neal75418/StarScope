import { useCallback, Dispatch, SetStateAction } from "react";
import { acknowledgeTriggeredAlert } from "../api/client";
import { Notification } from "./useNotifications";

interface StorageActions {
  markIdAsRead: (id: string) => void;
  markIdsAsRead: (ids: string[]) => void;
}

export function useNotificationActions(
  notifications: Notification[],
  setNotifications: Dispatch<SetStateAction<Notification[]>>,
  storage: StorageActions
) {
  const { markIdAsRead, markIdsAsRead } = storage;

  const handleAcknowledgeAlert = async (alertId: number) => {
    try {
      await acknowledgeTriggeredAlert(alertId);
    } catch (err) {
      console.warn(`Failed to acknowledge alert ${alertId}:`, err);
    }
  };

  const markAsRead = useCallback(
    async (notificationId: string) => {
      markIdAsRead(notificationId);

      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );

      // Identify and acknowledge alert on server
      const notification = notifications.find((n) => n.id === notificationId);
      if (notification?.type === "alert" && notification.metadata?.alertId) {
        await handleAcknowledgeAlert(notification.metadata.alertId);
      }
    },
    [markIdAsRead, notifications, setNotifications]
  );

  const markAllAsRead = useCallback(async () => {
    // Identify unread alerts
    const alertIdsToAcknowledge: number[] = [];
    notifications.forEach((n) => {
      if (!n.read && n.type === "alert" && n.metadata?.alertId) {
        alertIdsToAcknowledge.push(n.metadata.alertId);
      }
    });

    // Update storage
    markIdsAsRead(notifications.map((n) => n.id));

    // Update state
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));

    // Sync to server
    await Promise.all(alertIdsToAcknowledge.map(handleAcknowledgeAlert));
  }, [markIdsAsRead, notifications, setNotifications]);

  const clearNotification = useCallback(
    (notificationId: string) => {
      markIdAsRead(notificationId);
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
    },
    [markIdAsRead, setNotifications]
  );

  return {
    markAsRead,
    markAllAsRead,
    clearNotification,
  };
}
