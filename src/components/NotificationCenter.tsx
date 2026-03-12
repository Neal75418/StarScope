/**
 * 通知中心下拉選單元件，顯示應用內通知與未讀徽章。
 */

import { useRef, useCallback } from "react";
import { useI18n } from "../i18n";
import { useNotifications } from "../hooks/useNotifications";
import { useClickOutside } from "../hooks/useClickOutside";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { Page } from "../types/navigation";
import { NotificationTrigger } from "./notification-center/NotificationTrigger";
import { NotificationDropdown } from "./notification-center/NotificationDropdown";

interface NotificationCenterProps {
  onNavigate: (page: Page) => void;
}

export function NotificationCenter({ onNavigate }: NotificationCenterProps) {
  const { t } = useI18n();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    notifications,
    unreadCount,
    isLoading,
    isOpen,
    toggleOpen,
    close,
    markAsRead,
    markAllAsRead,
    clearNotification,
  } = useNotifications();

  // 點擊外部時關閉
  useClickOutside(dropdownRef, close, isOpen);

  // 按 ESC 關閉
  useEscapeKey(close, isOpen);

  const handleNavigate = useCallback(
    (page: Page) => {
      close();
      onNavigate(page);
    },
    [close, onNavigate]
  );

  const handleMarkAsRead = useCallback(
    (id: string) => {
      void markAsRead(id);
    },
    [markAsRead]
  );

  const handleMarkAllAsRead = useCallback(() => {
    void markAllAsRead();
  }, [markAllAsRead]);

  return (
    <div className="notification-center" ref={dropdownRef}>
      <NotificationTrigger isOpen={isOpen} unreadCount={unreadCount} onToggle={toggleOpen} t={t} />

      {isOpen && (
        <NotificationDropdown
          notifications={notifications}
          unreadCount={unreadCount}
          isLoading={isLoading}
          onMarkAllAsRead={handleMarkAllAsRead}
          onNavigate={handleNavigate}
          onClear={clearNotification}
          onMarkAsRead={handleMarkAsRead}
          t={t}
        />
      )}
    </div>
  );
}
