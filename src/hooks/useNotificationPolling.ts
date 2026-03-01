/**
 * 通知輪詢邏輯，定時取得已觸發警報。
 */

import { useState, useEffect, useCallback, useRef, Dispatch, SetStateAction } from "react";
import { listTriggeredAlerts } from "../api/client";
import {
  alertsToNotifications,
  sortNotifications,
  mergeNotifications,
} from "../utils/notificationHelpers";
import { Notification } from "./useNotifications";
import { MS_PER_MINUTE } from "../utils/format";
import { logger } from "../utils/logger";

const POLL_INTERVAL = MS_PER_MINUTE;

interface OSNotificationSender {
  sendOSNotification: (options: { title: string; body: string }) => Promise<void>;
  isGranted: boolean;
}

async function fetchAndMergeNotifications(
  setNotifications: Dispatch<SetStateAction<Notification[]>>,
  readIds: Set<string>,
  setError: Dispatch<SetStateAction<string | null>>,
  setIsLoading: Dispatch<SetStateAction<boolean>>,
  osNotificationSender?: OSNotificationSender,
  existingNotifications?: Notification[]
): Promise<void> {
  try {
    const alerts = await listTriggeredAlerts(false, 50);
    const newNotifications = sortNotifications(alertsToNotifications(alerts, readIds));

    // 檢測真正的新通知（之前不存在的）
    if (osNotificationSender?.isGranted && existingNotifications) {
      const existingIds = new Set(existingNotifications.map((n) => n.id));
      const brandNewNotifications = newNotifications.filter((n) => !existingIds.has(n.id));

      // 只對未讀的新通知發送 OS 通知
      const unreadNewNotifications = brandNewNotifications.filter((n) => !n.read);

      // 發送 OS 通知（限制最多 3 個，避免轟炸用戶）
      const notificationsToSend = unreadNewNotifications.slice(0, 3);

      for (const notification of notificationsToSend) {
        try {
          await osNotificationSender.sendOSNotification({
            title: "StarScope 警示",
            body: notification.message,
          });
        } catch (err) {
          // OS 通知失敗不影響應用內通知
          logger.warn("[Notification Polling] OS 通知發送失敗:", err);
        }
      }

      // 如果有更多未發送的，記錄 log
      if (unreadNewNotifications.length > 3) {
        logger.info(
          `[Notification Polling] 有 ${unreadNewNotifications.length - 3} 個額外的未讀通知未發送 OS 通知`
        );
      }
    }

    setNotifications((prev) => mergeNotifications(newNotifications, prev));
    setError(null);
  } catch (err) {
    setError(err instanceof Error ? err.message : "通知取得失敗");
  } finally {
    setIsLoading(false);
  }
}

export function useNotificationPolling(
  setNotifications: Dispatch<SetStateAction<Notification[]>>,
  readIdsRef: { current: Set<string> },
  osNotificationSender?: OSNotificationSender
) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 保存當前通知列表的 ref（用於檢測新通知）
  const notificationsRef = useRef<Notification[]>([]);

  // 使用 ref 讓輪詢 interval 總是呼叫最新邏輯，
  // 無需拆除重建。
  const fetchRef = useRef<() => Promise<void>>(() => Promise.resolve());
  fetchRef.current = () =>
    fetchAndMergeNotifications(
      (updater) => {
        setNotifications((prev) => {
          const updated = typeof updater === "function" ? updater(prev) : updater;
          notificationsRef.current = updated;
          return updated;
        });
      },
      readIdsRef.current,
      setError,
      setIsLoading,
      osNotificationSender,
      notificationsRef.current
    );

  // 建立穩定的輪詢，不可見時暫停，恢復可見時立即補抓一次。
  // 使用遞迴 setTimeout 避免請求重疊。
  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      timerId = setTimeout(() => {
        void poll();
      }, POLL_INTERVAL);
    };

    const poll = async () => {
      if (cancelled || document.hidden) return;
      await fetchRef.current();
      if (!cancelled) scheduleNext();
    };

    const handleVisibilityChange = () => {
      if (cancelled) return;
      if (document.hidden) {
        // 頁面不可見時清除排程
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
      } else {
        // 恢復可見時立即補抓一次並重新排程
        void poll();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // 初始載入
    void poll();

    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []); // 空依賴 — 僅建立一次，透過 ref 取得最新邏輯

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchRef.current();
  }, []);

  return { isLoading, error, refresh };
}
