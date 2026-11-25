/**
 * 通知輪詢邏輯，定時取得已觸發警報。
 * 使用 React Query + useSmartInterval 管理輪詢（visibility + online aware）。
 */

import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listTriggeredAlerts } from "../api/client";
import { ALERT_FETCH_LIMIT } from "../constants/api";
import {
  alertsToNotifications,
  sortNotifications,
  mergeNotifications,
} from "../utils/notificationHelpers";
import type { Notification } from "./useNotifications";
import type { LocalMarks } from "../utils/notificationHelpers";
import { NOTIFICATION_POLL_INTERVAL_MS, MAX_OS_NOTIFICATIONS_PER_POLL } from "../constants/polling";
import { logger } from "../utils/logger";
import { lastLoadFailed, loadInProgress, queryKeys } from "../lib/react-query";
import { useI18n } from "../i18n";
import { useSmartInterval } from "./useSmartInterval";

interface OSNotificationSender {
  sendOSNotification: (options: { title: string; body: string }) => Promise<void>;
  isGranted: boolean;
}

export function useNotificationPolling(
  setNotifications: Dispatch<SetStateAction<Notification[]>>,
  localMarksRef: { current: LocalMarks },
  osNotificationSender?: OSNotificationSender
) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // 判斷新通知的基準（null＝還沒讀回過，第一次讀回只當基準）：這次開 app 讀回過的通知，與看過的最新觸發時間。
  // 新通知＝沒讀回過、觸發時間不比看過的最新還舊的未讀。只看「讀回過沒有」的話，清除後滑進 50 則窗口、或重新追蹤的
  // repo 帶回的舊警報都會被當成新的；看「清單空不空」的話，清空之後的新警報會被當成第一次載入。
  // 前提是新警報的觸發時間不比之前的舊：伺服器時鐘往回調、兩個程序同時寫入時可能漏發系統通知（警報照樣列在鈴鐺裡）
  const seenRef = useRef<{ ids: Set<string>; newest: number } | null>(null);
  // 穩定的 ref 追蹤最新的 setter 和 sender
  const setNotificationsRef = useRef(setNotifications);
  setNotificationsRef.current = setNotifications;
  const osNotificationSenderRef = useRef(osNotificationSender);
  osNotificationSenderRef.current = osNotificationSender;
  const tRef = useRef(t);
  tRef.current = t;

  const smartInterval = useSmartInterval(NOTIFICATION_POLL_INTERVAL_MS);

  const query = useQuery<Notification[], Error>({
    queryKey: queryKeys.notifications.polling(),
    queryFn: async () => {
      const alerts = await listTriggeredAlerts(false, ALERT_FETCH_LIMIT, undefined, {
        excludeDismissed: true,
      });
      return sortNotifications(alertsToNotifications(alerts, tRef.current.dashboard.signals.types));
    },
    // 智慧輪詢：visibility + online aware
    refetchInterval: smartInterval,
    // 資料立即視為過期，確保每次 interval 都觸發 refetch
    staleTime: 0,
    // 不使用全域預設的 retry，避免輪詢失敗時重複
    retry: false,
    // 不使用 refetchOnWindowFocus（改用 smartInterval 管理）
    refetchOnWindowFocus: false,
    // 每次讀回都給新物件，下面的 effect 才會每次重套「後端狀態＋本機標記」：讀回的和上一輪一樣時共用同一個物件，
    // effect 不跑，畫面就停在本機改過的樣子（例如標已讀與清除都失敗後加回的那則，直到清單有別的變化前都顯示已讀）
    structuralSharing: false,
  });

  // 當 query 資料更新時，處理合併與 OS 通知（useEffect 避免 render 階段副作用）
  useEffect(() => {
    if (!query.data) return;
    const newNotifications = query.data;

    // 發送 OS 通知（對比新增的）
    const sender = osNotificationSenderRef.current;
    const seen = seenRef.current;
    const triggeredAt = newNotifications.map((n) => Date.parse(n.timestamp));
    const unreadNewNotifications =
      seen === null
        ? []
        : newNotifications.filter(
            (n, i) => !n.read && !seen.ids.has(n.id) && triggeredAt[i] >= seen.newest
          );
    const seenIds = seen?.ids ?? new Set<string>();
    for (const n of newNotifications) seenIds.add(n.id);
    seenRef.current = {
      ids: seenIds,
      newest: Math.max(seen?.newest ?? -Infinity, ...triggeredAt.filter(Number.isFinite)),
    };
    if (sender?.isGranted) {
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

    // 合併通知並更新 parent state：以讀回的為準，再套上這次開 app 的標記
    setNotificationsRef.current(mergeNotifications(newNotifications, localMarksRef.current));
  }, [query.data, localMarksRef]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.polling() });
  }, [queryClient]);

  return {
    // isPending 而不是 isLoading：sidecar 還沒連上時查詢是暫停的，isLoading 為 false，
    // 鈴鐺會誤說「沒有通知」（這個查詢沒有 enabled 條件，isPending 只在還沒拿到結果時為 true）
    isLoading: query.isPending,
    /** 最近一次有結果的讀取失敗了；重試、輪詢進行中也維持 true（還沒有資料時 React Query 的 error 在那時會被清成 null） */
    loadFailed: lastLoadFailed(query),
    loadInProgress: loadInProgress(query),
    refresh,
  };
}
