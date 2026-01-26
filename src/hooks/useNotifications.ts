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
    page: "watchlist" | "signals" | "settings";
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

  // Storage for read status
  const { readIdsRef, markIdAsRead, markIdsAsRead } = useNotificationStorage();

  // Polling logic
  const { isLoading, error, refresh } = useNotificationPolling(setNotifications, readIdsRef);

  // Action logic
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
