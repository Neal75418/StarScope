/**
 * 通知中心：整合儲存、輪詢與操作邏輯。
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { useNotificationStorage } from "./useNotificationStorage";
import { useNotificationPolling } from "./useNotificationPolling";
import { useNotificationActions } from "./useNotificationActions";
import { useOSNotification } from "./useOSNotification";
import { DATA_RESET_EVENT } from "../constants/events";
import type { Page } from "../types/navigation";

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
  };
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  // data-reset 事件：清空通知列表（已讀 ref 由 useNotificationStorage 自行清除）
  useEffect(() => {
    const handler = () => setNotifications([]);
    window.addEventListener(DATA_RESET_EVENT, handler);
    return () => window.removeEventListener(DATA_RESET_EVENT, handler);
  }, []);

  // 已讀狀態儲存
  const { readIdsRef, markIdAsRead, markIdsAsRead, removeIdFromRead } = useNotificationStorage();

  // OS 通知功能
  const osNotification = useOSNotification();

  // 輪詢邏輯（整合 OS 通知）
  const { isLoading, error, refresh } = useNotificationPolling(
    setNotifications,
    readIdsRef,
    osNotification
  );

  // 操作邏輯
  const { markAsRead, markAllAsRead, clearNotification } = useNotificationActions(
    notifications,
    setNotifications,
    { markIdAsRead, markIdsAsRead, removeIdFromRead }
  );

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
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
