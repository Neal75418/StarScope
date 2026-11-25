/**
 * 通知中心：整合輪詢與操作邏輯。
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useNotificationPolling } from "./useNotificationPolling";
import { useNotificationActions } from "./useNotificationActions";
import { useOSNotification } from "./useOSNotification";
import { useToast } from "../components/Toast";
import { DATA_RESET_EVENT } from "../constants/events";
import type { Page } from "../types/navigation";
import type { LocalMarks } from "../utils/notificationHelpers";

type NotificationType = "alert" | "signal" | "system";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  link?: {
    page: Page;
    params?: Record<string, string>;
  };
  metadata?: {
    repoName?: string;
    signalType?: string;
    alertId?: number;
    /** 觸發時間的原字串，確認時送回後端比對（id 會重用） */
    triggeredAt?: string;
  };
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const toast = useToast();
  // 這次開 app 標成已讀、清除過的通知（見 notificationHelpers）：輪詢合併與操作共用
  const localMarksRef = useRef<LocalMarks>({ reads: new Set(), dismissals: new Set() });

  // data-reset 事件：清空通知列表
  useEffect(() => {
    const handler = () => setNotifications([]);
    window.addEventListener(DATA_RESET_EVENT, handler);
    return () => window.removeEventListener(DATA_RESET_EVENT, handler);
  }, []);

  // OS 通知功能
  const osNotification = useOSNotification();

  // 輪詢邏輯（整合 OS 通知）
  const { isLoading, loadFailed, loadInProgress, refresh } = useNotificationPolling(
    setNotifications,
    localMarksRef,
    osNotification
  );

  // 操作邏輯
  const { markAsRead, markAllAsRead, clearNotification } = useNotificationActions(
    notifications,
    setNotifications,
    localMarksRef,
    { toast, refresh }
  );

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  return {
    notifications,
    unreadCount,
    isLoading,
    loadFailed,
    loadInProgress,
    isOpen,
    toggleOpen: useCallback(() => setIsOpen((prev) => !prev), []),
    close: useCallback(() => setIsOpen(false), []),
    markAsRead,
    markAllAsRead,
    clearNotification,
    refresh,
    // 暴露 OS 通知相關功能
    osNotification: {
      isGranted: osNotification.isGranted,
      isLoading: osNotification.isLoading,
      requestPermission: osNotification.requestNotificationPermission,
    },
  };
}
