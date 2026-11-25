/**
 * 通知的已讀、全部已讀與清除操作。
 *
 * 警報的已讀以後端的 acknowledged_at 為準，本機不持久化（見 notificationHelpers）：
 * - UI 立即切成已讀（快速回饋），同時記進 markedReads，輪詢讀回來時才不會被蓋回未讀
 * - ack 失敗時從 markedReads 拿掉、還原 UI、說明沒做成與原因並重讀
 * - 觸發紀錄已經不在時當成已經處理完（見 isAlertGone）
 * - 確認時帶上看到的觸發時間：後端那個 id 已經是別的警報時回「不在」，不會確認到它
 */

import { useCallback, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { acknowledgeTriggeredAlert } from "../api/client";
import { ApiError } from "../api/types";
import { interpolate, useI18n } from "../i18n";
import { keepRefetchingAfterTimeout } from "../lib/react-query";
import { describeWriteFailure, isRequestTimeout } from "../utils/writeFailure";
import type { MarkedReads } from "../utils/notificationHelpers";
import type { Notification } from "./useNotifications";
import type { Toast } from "./types";
import { logger } from "../utils/logger";

interface ActionFeedback {
  toast: Toast;
  /** 重讀通知清單（輪詢的那份查詢；呼叫端卸載後仍有效） */
  refresh: () => Promise<void>;
}

/**
 * 看到的那則觸發紀錄已經不在：它的規則或儲存庫刪了（連帶刪除）、資料重設過，或 id 已被新警報重用。
 * 使用者要的「已讀」「不見」等於已經達成，所以不還原、不提示，重讀讓它從清單消失
 */
function isAlertGone(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 404 && error.code === "TRIGGERED_ALERT_NOT_FOUND"
  );
}

/** 要送確認的警報：id 與清單上看到的觸發時間 */
function alertTarget(notification: Notification | undefined) {
  if (notification?.type !== "alert") return null;
  const alertId = notification.metadata?.alertId;
  if (alertId == null) return null;
  return { alertId, triggeredAt: notification.metadata?.triggeredAt };
}

export function useNotificationActions(
  notifications: Notification[],
  setNotifications: Dispatch<SetStateAction<Notification[]>>,
  markedReadsRef: { current: MarkedReads },
  feedback: ActionFeedback
) {
  const { toast, refresh } = feedback;
  const { t } = useI18n();

  // 用 ref 保持最新的 notifications，避免 useCallback 閉包捕獲過期陣列
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;

  /** 確認送出前記下：輪詢在確認回來之前讀回未讀，也照樣顯示已讀 */
  const claimRead = useCallback(
    (notificationId: string) => {
      markedReadsRef.current.add(notificationId);
    },
    [markedReadsRef]
  );

  const dropClaim = useCallback(
    (notificationId: string) => {
      markedReadsRef.current.delete(notificationId);
    },
    [markedReadsRef]
  );

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
      const target = alertTarget(notificationsRef.current.find((n) => n.id === notificationId));

      // 樂觀更新 UI
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
      // 非警報沒有後端可確認，畫面上的已讀就是全部
      if (target === null) return;

      claimRead(notificationId);
      try {
        await acknowledgeTriggeredAlert(target.alertId, target.triggeredAt);
      } catch (err) {
        dropClaim(notificationId);
        if (isAlertGone(err)) {
          reload();
          return;
        }
        logger.warn(
          `[NotificationActions] 警報確認失敗，還原已讀狀態 (alertId: ${target.alertId}):`,
          err
        );
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? { ...n, read: false } : n))
        );
        reportFailure(err, t.notifications.failed.markRead);
        reloadAfterFailure(isRequestTimeout(err));
      }
    },
    [setNotifications, claimRead, dropClaim, reload, reportFailure, reloadAfterFailure, t]
  );

  const markAllAsRead = useCallback(async () => {
    const unreadAlerts: { notifId: string; alertId: number; triggeredAt?: string }[] = [];
    for (const n of notificationsRef.current) {
      if (n.read) continue;
      const target = alertTarget(n);
      if (target !== null) unreadAlerts.push({ notifId: n.id, ...target });
    }

    // 樂觀更新 UI
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    if (unreadAlerts.length === 0) return;

    // 警報：逐一 ack
    for (const { notifId } of unreadAlerts) claimRead(notifId);
    const results = await Promise.allSettled(
      unreadAlerts.map(({ alertId, triggeredAt }) =>
        acknowledgeTriggeredAlert(alertId, triggeredAt)
      )
    );

    const failures: { notifId: string; error: unknown }[] = [];
    let anyGone = false;

    results.forEach((r, i) => {
      const { notifId } = unreadAlerts[i];
      if (r.status === "fulfilled") return;
      dropClaim(notifId);
      if (isAlertGone(r.reason)) {
        anyGone = true;
      } else {
        failures.push({ notifId, error: r.reason });
      }
    });

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
  }, [setNotifications, claimRead, dropClaim, reload, reportFailure, reloadAfterFailure, t]);

  const clearNotification = useCallback(
    async (notificationId: string) => {
      const notification = notificationsRef.current.find((n) => n.id === notificationId);
      const target = alertTarget(notification);

      // 樂觀更新 UI
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
      if (target === null) return;

      // 警報類型：嘗試 server ack。失敗時還原通知到列表中
      claimRead(notificationId);
      try {
        await acknowledgeTriggeredAlert(target.alertId, target.triggeredAt);
      } catch (err) {
        dropClaim(notificationId);
        if (isAlertGone(err)) {
          reload();
          return;
        }
        logger.warn(
          `[NotificationActions] 清除通知時警報確認失敗 (alertId: ${target.alertId}):`,
          err
        );
        // 還原：照清除前的樣子加回列表，接著的重讀會換成後端的狀態
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
    },
    [setNotifications, claimRead, dropClaim, reload, reportFailure, reloadAfterFailure, t]
  );

  return {
    markAsRead,
    markAllAsRead,
    clearNotification,
  };
}
