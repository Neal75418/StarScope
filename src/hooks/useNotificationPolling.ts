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
import {
  invalidateTriggeredAlerts,
  lastLoadFailed,
  loadInProgress,
  queryKeys,
} from "../lib/react-query";
import { useI18n } from "../i18n";
import { useSmartInterval } from "./useSmartInterval";

/** 一次讀回的通知與送出這次讀取的時間（本機時鐘；sidecar 在同一台機器，觸發時間用的是同一個時鐘） */
interface PolledNotifications {
  notifications: Notification[];
  requestedAt: number;
}

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
  // 看過的最新至少是第一次讀取送出的時間：只看讀回的內容的話，第一次讀回是空的、或封存前觸發（封存期間不列）的警報比
  // 讀回的都新時，重新追蹤帶回的舊警報仍會被當成新的。用送出的時間而不是讀回的時間：送出之後才觸發、那次沒讀到的要算新的。
  // 前提是新警報的觸發時間不比之前的舊：伺服器時鐘往回調、兩個程序同時寫入時可能漏發系統通知（警報照樣列在鈴鐺裡）；
  // 第一次讀取送出時已經取了觸發時間、還沒寫進資料庫的那一筆也會漏發：通常是毫秒，其他寫入正在進行時要等它寫完
  // （鎖等待最多 30 秒）。之後的讀取不拿送出的時間墊高：每一輪都會有這個空檔
  const seenRef = useRef<{ ids: Set<string>; newest: number } | null>(null);
  // 穩定的 ref 追蹤最新的 setter 和 sender
  const setNotificationsRef = useRef(setNotifications);
  setNotificationsRef.current = setNotifications;
  const osNotificationSenderRef = useRef(osNotificationSender);
  osNotificationSenderRef.current = osNotificationSender;
  const tRef = useRef(t);
  tRef.current = t;

  const smartInterval = useSmartInterval(NOTIFICATION_POLL_INTERVAL_MS);

  const query = useQuery<PolledNotifications, Error>({
    queryKey: queryKeys.notifications.polling(),
    queryFn: async () => {
      // 跟著資料一起回：放 ref 的話，下一次讀取可能在 effect 處理這次的結果之前就開始、把它蓋掉
      const requestedAt = Date.now();
      const alerts = await listTriggeredAlerts(false, ALERT_FETCH_LIMIT, undefined, {
        excludeDismissed: true,
      });
      return {
        notifications: sortNotifications(
          alertsToNotifications(alerts, tRef.current.dashboard.signals.types)
        ),
        requestedAt,
      };
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
    const { notifications: newNotifications, requestedAt } = query.data;

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
    // 讀到這次開 app 沒讀回過的：儀表板那份不輪詢（掛著時不會自己重讀），跟著鈴鐺重讀。背景排程與收集器觸發的新警報，
    // 會定時讀到的只有這裡；app 裡的寫入另外會兩份一起重讀（見 invalidateTriggeredAlerts），讀回沒看過的時這裡會再讀一次。
    // 有讀取還在路上時，它可能是新警報之前送的（分不出來就一律重讀）。畫面上掛著、而且已經有資料時，invalidate 自己會換成
    // 新的讀取，等著的人（invalidateTriggeredAlerts）照樣等到新的讀完，所以不取消。其餘先取消再重讀：還沒有資料時
    // invalidate 會併進那個請求；沒掛著時 invalidate 不重讀，那次讀取回來會把「要重讀」清掉，5 分鐘內再掛上都是舊的。
    // 鈴鐺第一次讀回只當基準：第一次讀取失敗、下一輪才讀到的話，中間觸發的不會帶動儀表板
    if (seen !== null && newNotifications.some((n) => !seen.ids.has(n.id))) {
      const dashboardAlerts = { queryKey: queryKeys.alerts.triggered() };
      const dashboardQuery = queryClient.getQueryCache().find({ ...dashboardAlerts, exact: true });
      if (dashboardQuery?.state.data === undefined || !dashboardQuery.isActive()) {
        void queryClient.cancelQueries(dashboardAlerts);
      }
      void queryClient.invalidateQueries(dashboardAlerts);
    }
    const seenIds = seen?.ids ?? new Set<string>();
    for (const n of newNotifications) seenIds.add(n.id);
    seenRef.current = {
      ids: seenIds,
      newest: Math.max(seen?.newest ?? requestedAt, ...triggeredAt.filter(Number.isFinite)),
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
  }, [query.data, localMarksRef, queryClient]);

  // Dashboard 也一起：通知中心在確認、清除之後用它重讀，Dashboard 的警報數是同一份資料
  const refresh = useCallback(() => invalidateTriggeredAlerts(queryClient), [queryClient]);

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
