/**
 * 通知的已讀、全部已讀與清除操作。
 *
 * 警報類型通知使用「樂觀 UI + server ack 後持久化」策略：
 * - UI 立即切成已讀（快速回饋）
 * - 標已讀只在 server ack 成功後才寫入 localStorage；清除先寫入，失敗時再拿掉
 * - ack 失敗時還原 UI、說明沒做成與原因並重讀，避免本地與後端永久分歧
 * - 觸發紀錄已經不在時當成已經處理完（見 isAlertGone）
 */

import { useCallback, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { acknowledgeTriggeredAlert } from "../api/client";
import { ApiError } from "../api/types";
import { interpolate, useI18n } from "../i18n";
import { keepRefetchingAfterTimeout } from "../lib/react-query";
import { describeWriteFailure, isRequestTimeout } from "../utils/writeFailure";
import type { Notification } from "./useNotifications";
import type { Toast } from "./types";
import { logger } from "../utils/logger";

interface StorageActions {
  markIdAsRead: (id: string) => void;
  markIdsAsRead: (ids: string[]) => void;
  removeIdFromRead: (id: string) => void;
}

interface ActionFeedback {
  toast: Toast;
  /** 重讀通知清單（輪詢的那份查詢；呼叫端卸載後仍有效） */
  refresh: () => Promise<void>;
}

/**
 * 觸發紀錄已經不在：它的規則或儲存庫刪了（連帶刪除），或資料重設過。使用者要的「已讀」「不見」等於已經達成，
 * 所以不還原、不提示，重讀讓它從清單消失。也不記住它的已讀 id：觸發紀錄的 id 會重用，記住的話之後拿到同一個 id
 * 的新警報會直接顯示成已讀
 */
function isAlertGone(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 404 && error.code === "TRIGGERED_ALERT_NOT_FOUND"
  );
}

export function useNotificationActions(
  notifications: Notification[],
  setNotifications: Dispatch<SetStateAction<Notification[]>>,
  storage: StorageActions,
  feedback: ActionFeedback
) {
  const { markIdAsRead, markIdsAsRead, removeIdFromRead } = storage;
  const { toast, refresh } = feedback;
  const { t } = useI18n();

  // 用 ref 保持最新的 notifications，避免 useCallback 閉包捕獲過期陣列
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;

  const reload = useCallback(() => {
    refresh().catch((err: unknown) => {
      logger.warn("[NotificationActions] 確認後重讀通知失敗:", err);
    });
  }, [refresh]);

  /** 失敗後重讀：失敗也可能是伺服器其實做完了。有逾時的話伺服器可能還在做，接下來一陣子定期重讀 */
  const reloadAfterFailure = useCallback(
    (anyTimedOut: boolean) => {
      reload();
      if (anyTimedOut) keepRefetchingAfterTimeout(reload);
    },
    [reload]
  );

  /** 逾時只是不確定有沒有做成，用警告；其餘是這一次沒做成，用錯誤。後端的原始訊息不上畫面 */
  const reportFailure = useCallback(
    (error: unknown, copy: { notDone: string; timedOut: string }) => {
      const message = describeWriteFailure(error, t, copy);
      if (isRequestTimeout(error)) {
        toast.warning(message);
      } else {
        toast.error(message);
      }
    },
    [t, toast]
  );

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
          if (isAlertGone(err)) {
            reload();
            return;
          }
          logger.warn(
            `[NotificationActions] 警報確認失敗，還原已讀狀態 (alertId: ${alertId}):`,
            err
          );
          setNotifications((prev) =>
            prev.map((n) => (n.id === notificationId ? { ...n, read: false } : n))
          );
          reportFailure(err, t.notifications.failed.markRead);
          reloadAfterFailure(isRequestTimeout(err));
        }
      } else {
        // 非警報：直接持久化（localStorage 就是唯一真相）
        markIdAsRead(notificationId);
      }
    },
    [markIdAsRead, setNotifications, reload, reportFailure, reloadAfterFailure, t]
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
      const failures: { notifId: string; error: unknown }[] = [];
      let anyGone = false;

      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          succeededIds.push(r.value);
        } else if (isAlertGone(r.reason)) {
          anyGone = true;
        } else {
          failures.push({ notifId: unreadAlerts[i].notifId, error: r.reason });
        }
      });

      if (succeededIds.length > 0) {
        markIdsAsRead(succeededIds);
      }

      // 還原失敗的警報 UI。確定沒做成的與逾時的分開說：逾時的可能其實做完了，只能說不確定
      if (failures.length > 0) {
        const failedSet = new Set(failures.map((f) => f.notifId));
        setNotifications((prev) =>
          prev.map((n) => (failedSet.has(n.id) ? { ...n, read: false } : n))
        );
        const copy = t.notifications.failed.markAllRead;
        const definite = failures.filter((f) => !isRequestTimeout(f.error));
        const timedOut = failures.filter((f) => isRequestTimeout(f.error));
        for (const group of [definite, timedOut]) {
          if (group.length === 0) continue;
          const count = group.length;
          // 原因取第一則：同一批請求同時送出，原因幾乎總是同一個
          reportFailure(group[0].error, {
            notDone: interpolate(copy.notDone, { count }),
            timedOut: interpolate(copy.timedOut, { count }),
          });
        }
        reloadAfterFailure(timedOut.length > 0);
      } else if (anyGone) {
        reload();
      }
    }
  }, [markIdsAsRead, setNotifications, reload, reportFailure, reloadAfterFailure, t]);

  const clearNotification = useCallback(
    async (notificationId: string) => {
      const notification = notificationsRef.current.find((n) => n.id === notificationId);
      const alertId = notification?.type === "alert" ? notification.metadata?.alertId : undefined;

      // 樂觀更新 UI
      markIdAsRead(notificationId);
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));

      // 警報類型：嘗試 server ack。失敗時還原通知到列表中
      if (alertId != null) {
        try {
          await acknowledgeTriggeredAlert(alertId);
        } catch (err) {
          // 兩種情況都拿掉清除時先寫入的已讀 id：失敗了不該留；已經不在的話 id 會重用（見 isAlertGone）。
          // 本來就已讀的不受影響：警報的已讀看後端的 acknowledged_at
          removeIdFromRead(notificationId);
          if (isAlertGone(err)) {
            reload();
            return;
          }
          logger.warn(`[NotificationActions] 清除通知時警報確認失敗 (alertId: ${alertId}):`, err);
          // 還原：照清除前的樣子加回列表（本來就已讀的不會變成未讀）
          if (notification) {
            setNotifications((prev) => {
              // 避免重複（輪詢可能已加回）
              if (prev.some((n) => n.id === notificationId)) return prev;
              return [...prev, notification];
            });
          }
          reportFailure(err, t.notifications.failed.clear);
          reloadAfterFailure(isRequestTimeout(err));
        }
      }
    },
    [markIdAsRead, removeIdFromRead, setNotifications, reload, reportFailure, reloadAfterFailure, t]
  );

  return {
    markAsRead,
    markAllAsRead,
    clearNotification,
  };
}
