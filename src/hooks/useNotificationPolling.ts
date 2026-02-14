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

const POLL_INTERVAL = MS_PER_MINUTE;

async function fetchAndMergeNotifications(
  setNotifications: Dispatch<SetStateAction<Notification[]>>,
  readIds: Set<string>,
  setError: Dispatch<SetStateAction<string | null>>,
  setIsLoading: Dispatch<SetStateAction<boolean>>
): Promise<void> {
  try {
    const alerts = await listTriggeredAlerts(false, 50);
    const newNotifications = sortNotifications(alertsToNotifications(alerts, readIds));
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
  readIdsRef: { current: Set<string> }
) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 使用 ref 讓輪詢 interval 總是呼叫最新邏輯，
  // 無需拆除重建。
  const fetchRef = useRef<() => Promise<void>>(() => Promise.resolve());
  fetchRef.current = () =>
    fetchAndMergeNotifications(setNotifications, readIdsRef.current, setError, setIsLoading);

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
