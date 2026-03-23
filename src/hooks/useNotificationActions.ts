/**
 * 通知的已讀、全部已讀與清除操作。
 *
 * 警報類型通知使用「樂觀 UI + server ack 後持久化」策略：
 * - UI 立即切成已讀（快速回饋）
 * - 只在 server ack 成功後才寫入 localStorage
 * - ack 失敗時還原 UI，避免本地與後端永久分歧
 */

import { useCallback, useRef, Dispatch, SetStateAction } from "react";
import { acknowledgeTriggeredAlert } from "../api/client";
import { Notification } from "./useNotifications";
import { logger } from "../utils/logger";

interface StorageActions {
  markIdAsRead: (id: string) => void;
  markIdsAsRead: (ids: string[]) => void;
  removeIdFromRead: (id: string) => void;
}

export function useNotificationActions(
  notifications: Notification[],
  setNotifications: Dispatch<SetStateAction<Notification[]>>,
  storage: StorageActions
) {
  const { markIdAsRead, markIdsAsRead, removeIdFromRead } = storage;

  // 用 ref 保持最新的 notifications，避免 useCallback 閉包捕獲過期陣列
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;

  const markAsRead = useCallback(
    async (notificationId: string) => {
      const notification = notificationsRef.current.find((n) => n.id === notificationId);
      const alertId = notification?.type === "alert" ? notification.metadata?.alertId : undefined;

      // 樂觀更新 UI
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );

      if (alertId != null) {
        // 警報類型：server ack 成功後才持久化
        try {
          await acknowledgeTriggeredAlert(alertId);
          markIdAsRead(notificationId);
        } catch (err) {
          logger.warn(
            `[NotificationActions] 警報確認失敗，還原已讀狀態 (alertId: ${alertId}):`,
            err
          );
          setNotifications((prev) =>
            prev.map((n) => (n.id === notificationId ? { ...n, read: false } : n))
          );
        }
      } else {
        // 非警報：直接持久化（localStorage 就是唯一真相）
        markIdAsRead(notificationId);
      }
    },
    [markIdAsRead, setNotifications]
  );

  const markAllAsRead = useCallback(async () => {
    const current = notificationsRef.current;

    // 分離警報與非警報
    const unreadAlerts: { notifId: string; alertId: number }[] = [];
    const nonAlertIds: string[] = [];

    current.forEach((n) => {
      if (n.read) return;
      if (n.type === "alert" && n.metadata?.alertId) {
        unreadAlerts.push({ notifId: n.id, alertId: n.metadata.alertId });
      } else {
        nonAlertIds.push(n.id);
      }
    });

    // 樂觀更新 UI
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));

    // 非警報：直接持久化
    if (nonAlertIds.length > 0) {
      markIdsAsRead(nonAlertIds);
    }

    // 警報：逐一 ack，成功才持久化
    if (unreadAlerts.length > 0) {
      const results = await Promise.allSettled(
        unreadAlerts.map(async ({ notifId, alertId }) => {
          await acknowledgeTriggeredAlert(alertId);
          return notifId;
        })
      );

      const succeededIds: string[] = [];
      const failedIds: string[] = [];

      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          succeededIds.push(r.value);
        } else {
          failedIds.push(unreadAlerts[i].notifId);
        }
      });

      if (succeededIds.length > 0) {
        markIdsAsRead(succeededIds);
      }

      // 還原失敗的警報 UI
      if (failedIds.length > 0) {
        const failedSet = new Set(failedIds);
        setNotifications((prev) =>
          prev.map((n) => (failedSet.has(n.id) ? { ...n, read: false } : n))
        );
      }
    }
  }, [markIdsAsRead, setNotifications]);

  const clearNotification = useCallback(
    async (notificationId: string) => {
      const notification = notificationsRef.current.find((n) => n.id === notificationId);
      const alertId = notification?.type === "alert" ? notification.metadata?.alertId : undefined;

      // 樂觀更新 UI
      markIdAsRead(notificationId);
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));

      // 警報類型：嘗試 server ack。失敗時還原（使用者明確清除但 server 仍持有該警報）
      if (alertId != null) {
        try {
          await acknowledgeTriggeredAlert(alertId);
        } catch (err) {
          logger.warn(`[NotificationActions] 清除通知時警報確認失敗 (alertId: ${alertId}):`, err);
          // 還原：從 localStorage 移除已讀標記，讓下次輪詢能重新顯示
          removeIdFromRead(notificationId);
        }
      }
    },
    [markIdAsRead, removeIdFromRead, setNotifications]
  );

  return {
    markAsRead,
    markAllAsRead,
    clearNotification,
  };
}
