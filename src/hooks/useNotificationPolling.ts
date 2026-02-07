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

  // 建立穩定的輪詢 interval，不會重新建立
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (!cancelled) {
        await fetchRef.current();
      }
    };

    void poll();

    const intervalId = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []); // 空依賴 — interval 僅建立一次，透過 ref 取得最新邏輯

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchRef.current();
  }, []);

  return { isLoading, error, refresh };
}
