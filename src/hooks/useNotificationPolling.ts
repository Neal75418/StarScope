import { useState, useEffect, useCallback, useRef, Dispatch, SetStateAction } from "react";
import { listTriggeredAlerts } from "../api/client";
import {
  alertsToNotifications,
  sortNotifications,
  mergeNotifications,
} from "../utils/notificationHelpers";
import { Notification } from "./useNotifications";

const POLL_INTERVAL = 60000; // 1 minute

export function useNotificationPolling(
  setNotifications: Dispatch<SetStateAction<Notification[]>>,
  readIdsRef: { current: Set<string> }
) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      // Fetch unacknowledged alerts
      const alerts = await listTriggeredAlerts(false, 50);

      // Convert and sort
      const newNotifications = sortNotifications(alertsToNotifications(alerts, readIdsRef.current));

      // Merge with existing state
      setNotifications((prev) => mergeNotifications(newNotifications, prev));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch notifications");
    } finally {
      setIsLoading(false);
    }
  }, [readIdsRef, setNotifications]);

  // Initial fetch operations
  useEffect(() => {
    // Initial fetch
    void fetchNotifications();

    // Polling setup
    pollIntervalRef.current = window.setInterval(() => {
      void fetchNotifications();
    }, POLL_INTERVAL);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [fetchNotifications]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchNotifications();
  }, [fetchNotifications]);

  return { isLoading, error, refresh };
}
