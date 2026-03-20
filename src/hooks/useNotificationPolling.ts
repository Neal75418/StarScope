/**
 * 通知輪詢邏輯，定時取得已觸發警報。
 * 使用 React Query 的 refetchInterval 管理輪詢，visibility 不可見時暫停。
 */

import { useCallback, useEffect, useRef, Dispatch, SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listTriggeredAlerts } from "../api/client";
import {
  alertsToNotifications,
  sortNotifications,
  mergeNotifications,
} from "../utils/notificationHelpers";
import { Notification } from "./useNotifications";
import { NOTIFICATION_POLL_INTERVAL_MS, MAX_OS_NOTIFICATIONS_PER_POLL } from "../constants/polling";
import { logger } from "../utils/logger";
import { queryKeys } from "../lib/react-query";
import { useI18n } from "../i18n";

interface OSNotificationSender {
  sendOSNotification: (options: { title: string; body: string }) => Promise<void>;
  isGranted: boolean;
}

export function useNotificationPolling(
  setNotifications: Dispatch<SetStateAction<Notification[]>>,
  readIdsRef: { current: Set<string> },
  osNotificationSender?: OSNotificationSender
) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // 保存當前通知列表的 ref（用於檢測新通知）
  const notificationsRef = useRef<Notification[]>([]);
  // 穩定的 ref 追蹤最新的 setter 和 sender
  const setNotificationsRef = useRef(setNotifications);
  setNotificationsRef.current = setNotifications;
  const osNotificationSenderRef = useRef(osNotificationSender);
  osNotificationSenderRef.current = osNotificationSender;
  const tRef = useRef(t);
  tRef.current = t;

  const query = useQuery<Notification[], Error>({
    queryKey: queryKeys.notifications.polling(),
    queryFn: async () => {
      const alerts = await listTriggeredAlerts(false, 50);
      return sortNotifications(alertsToNotifications(alerts, readIdsRef.current));
    },
    // 輪詢間隔：頁面不可見時停止
    refetchInterval: () => {
      if (typeof document !== "undefined" && document.hidden) {
        return false;
      }
      return NOTIFICATION_POLL_INTERVAL_MS;
    },
    // 資料立即視為過期，確保每次 interval 都觸發 refetch
    staleTime: 0,
    // 不使用全域預設的 retry，避免輪詢失敗時重複
    retry: false,
    // 不使用 refetchOnWindowFocus（改用 visibility-based refetchInterval）
    refetchOnWindowFocus: false,
  });

  // 當 query 資料更新時，處理合併與 OS 通知（useEffect 避免 render 階段副作用）
  useEffect(() => {
    if (!query.data) return;
    const newNotifications = query.data;

    // 發送 OS 通知（對比新增的）
    const sender = osNotificationSenderRef.current;
    if (sender?.isGranted && notificationsRef.current.length > 0) {
      const existingIds = new Set(notificationsRef.current.map((n) => n.id));
      const brandNewNotifications = newNotifications.filter((n) => !existingIds.has(n.id));
      const unreadNewNotifications = brandNewNotifications.filter((n) => !n.read);
      const notificationsToSend = unreadNewNotifications.slice(0, MAX_OS_NOTIFICATIONS_PER_POLL);

      for (const notification of notificationsToSend) {
        void sender
          .sendOSNotification({
            title: tRef.current.notifications.osTitle,
            body: notification.message,
          })
          .catch((err: unknown) => {
            logger.warn("[Notification Polling] OS 通知發送失敗:", err);
          });
      }

      if (unreadNewNotifications.length > MAX_OS_NOTIFICATIONS_PER_POLL) {
        logger.info(
          `[Notification Polling] 有 ${unreadNewNotifications.length - MAX_OS_NOTIFICATIONS_PER_POLL} 個額外的未讀通知未發送 OS 通知`
        );
      }
    }

    // 合併通知並更新 parent state
    setNotificationsRef.current((prev) => {
      const updated = mergeNotifications(newNotifications, prev);
      notificationsRef.current = updated;
      return updated;
    });
  }, [query.data]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.polling() });
  }, [queryClient]);

  return {
    isLoading: query.isLoading,
    error: query.error ? query.error.message || t.notifications.fetchFailed : null,
    refresh,
  };
}
