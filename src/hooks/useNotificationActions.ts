/**
 * 通知的已讀、全部已讀與清除操作。
 */

import { useCallback, useRef, Dispatch, SetStateAction } from "react";
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

  // 用 ref 保持最新的 notifications，避免 useCallback 閉包捕獲過期陣列
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;

  const handleAcknowledgeAlert = useCallback(async (alertId: number) => {
    try {
      await acknowledgeTriggeredAlert(alertId);
    } catch (err) {
      logger.warn(`[NotificationActions] 警報確認失敗 (ID: ${alertId}):`, err);
    }
  }, []);

  const markAsRead = useCallback(
    async (notificationId: string) => {
      markIdAsRead(notificationId);

      // 樂觀更新 UI
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );

      // 若為警報類型，同步確認至伺服器
      const notification = notificationsRef.current.find((n) => n.id === notificationId);
      if (notification?.type === "alert" && notification.metadata?.alertId) {
        await handleAcknowledgeAlert(notification.metadata.alertId);
      }
    },
    [handleAcknowledgeAlert, markIdAsRead, setNotifications]
  );

  const markAllAsRead = useCallback(async () => {
    const current = notificationsRef.current;

    // 找出未讀警報
    const alertIdsToAcknowledge: number[] = [];
    current.forEach((n) => {
      if (!n.read && n.type === "alert" && n.metadata?.alertId) {
        alertIdsToAcknowledge.push(n.metadata.alertId);
      }
    });

    // 更新儲存狀態
    markIdsAsRead(current.map((n) => n.id));

    // 更新元件狀態
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));

    // 同步至伺服器（allSettled 確保單一失敗不中斷其他）
    await Promise.allSettled(alertIdsToAcknowledge.map(handleAcknowledgeAlert));
  }, [handleAcknowledgeAlert, markIdsAsRead, setNotifications]);

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
