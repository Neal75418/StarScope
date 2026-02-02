import { useState, useEffect, useCallback, useRef, Dispatch, SetStateAction } from "react";
import { listTriggeredAlerts } from "../api/client";
import {
  alertsToNotifications,
  sortNotifications,
  mergeNotifications,
} from "../utils/notificationHelpers";
import { Notification } from "./useNotifications";

const POLL_INTERVAL = 60000; // 1 minute

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
    setError(err instanceof Error ? err.message : "Failed to fetch notifications");
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

  // Use a ref so the polling interval always calls the latest logic
  // without needing to be torn down and recreated.
  const fetchRef = useRef<() => Promise<void>>(() => Promise.resolve());
  fetchRef.current = () =>
    fetchAndMergeNotifications(setNotifications, readIdsRef.current, setError, setIsLoading);

  // Set up polling with a stable interval that never re-creates
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
  }, []); // Empty deps — interval is created once and uses ref for latest logic

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchRef.current();
  }, []);

  return { isLoading, error, refresh };
}
