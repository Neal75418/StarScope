/**
 * 通知的已讀、全部已讀與清除操作。
 */

import { useCallback, Dispatch, SetStateAction } from "react";
import { acknowledgeTriggeredAlert } from "../api/client";
import { Notification } from "./useNotifications";
import { logger } from "../utils/logger";

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
      logger.warn(`[NotificationActions] 警報確認失敗 (ID: ${alertId}):`, err);
    }
  };

  const markAsRead = useCallback(
    async (notificationId: string) => {
      markIdAsRead(notificationId);

      // 樂觀更新 UI
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );

      // 若為警報類型，同步確認至伺服器
      const notification = notifications.find((n) => n.id === notificationId);
      if (notification?.type === "alert" && notification.metadata?.alertId) {
        await handleAcknowledgeAlert(notification.metadata.alertId);
      }
    },
    [markIdAsRead, notifications, setNotifications]
  );

  const markAllAsRead = useCallback(async () => {
    // 找出未讀警報
    const alertIdsToAcknowledge: number[] = [];
    notifications.forEach((n) => {
      if (!n.read && n.type === "alert" && n.metadata?.alertId) {
        alertIdsToAcknowledge.push(n.metadata.alertId);
      }
    });

    // 更新儲存狀態
    markIdsAsRead(notifications.map((n) => n.id));

    // 更新元件狀態
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));

    // 同步至伺服器
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
