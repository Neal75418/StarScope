/**
 * 通知中心：整合儲存、輪詢與操作邏輯。
 */

import { useState, useCallback } from "react";
import { useNotificationStorage } from "./useNotificationStorage";
import { useNotificationPolling } from "./useNotificationPolling";
import { useNotificationActions } from "./useNotificationActions";

export type NotificationType = "alert" | "signal" | "system";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  link?: {
    page: "watchlist" | "dashboard" | "settings";
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

  // 已讀狀態儲存
  const { readIdsRef, markIdAsRead, markIdsAsRead } = useNotificationStorage();

  // 輪詢邏輯
  const { isLoading, error, refresh } = useNotificationPolling(setNotifications, readIdsRef);

  // 操作邏輯
  const { markAsRead, markAllAsRead, clearNotification } = useNotificationActions(
    notifications,
    setNotifications,
    { markIdAsRead, markIdsAsRead }
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

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
  };
}
