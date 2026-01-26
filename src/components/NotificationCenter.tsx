/**
 * Notification center dropdown component.
 * Shows in-app notifications with unread badge.
 */

import { useEffect, useRef, memo, useCallback } from "react";
import { BellIcon, CheckIcon, XIcon } from "./Icons";
import { useI18n } from "../i18n";
import { Notification, useNotifications } from "../hooks/useNotifications";

type Page = "dashboard" | "discovery" | "watchlist" | "trends" | "compare" | "signals" | "settings";

interface NotificationCenterProps {
  onNavigate: (page: Page) => void;
}

const NotificationItem = memo(({
  notification,
  onMarkAsRead,
  onClear,
  onNavigate,
}: {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onClear: (id: string) => void;
  onNavigate: (page: Page) => void;
}) => {
  const { t } = useI18n();

  const handleClick = () => {
    if (!notification.read) {
      onMarkAsRead(notification.id);
    }
    if (notification.link) {
      onNavigate(notification.link.page);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClear(notification.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Don't handle if the target is a button (let button handle its own events)
    if ((e.target as HTMLElement).tagName === "BUTTON") {
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  const timeAgo = formatTimeAgo(notification.timestamp, t);

  return (
    <div
      className={`notification-item ${notification.read ? "read" : "unread"}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="notification-icon">
        {notification.type === "alert" && <span className="notification-type alert">!</span>}
        {notification.type === "signal" && <span className="notification-type signal">⚡</span>}
        {notification.type === "system" && <span className="notification-type system">ℹ</span>}
      </div>
      <div className="notification-content">
        <div className="notification-title">{notification.title}</div>
        <div className="notification-message">{notification.message}</div>
        <div className="notification-time">{timeAgo}</div>
      </div>
      <button
        className="notification-clear"
        onClick={handleClear}
        aria-label={t.notifications.clear}
        title={t.notifications.clear}
      >
        <XIcon size={14} />
      </button>
    </div>
  );
});
NotificationItem.displayName = "NotificationItem";

function formatTimeAgo(timestamp: string, t: ReturnType<typeof useI18n>["t"]): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return t.notifications.justNow;
  } else if (diffMins < 60) {
    return t.notifications.minutesAgo.replace("{n}", String(diffMins));
  } else if (diffHours < 24) {
    return t.notifications.hoursAgo.replace("{n}", String(diffHours));
  } else {
    return t.notifications.daysAgo.replace("{n}", String(diffDays));
  }
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

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        close();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, close]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        close();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, close]);

  const handleNavigate = useCallback((page: Page) => {
    close();
    onNavigate(page);
  }, [close, onNavigate]);

  const handleMarkAsRead = useCallback((id: string) => {
    void markAsRead(id);
  }, [markAsRead]);

  const handleMarkAllAsRead = useCallback(() => {
    void markAllAsRead();
  }, [markAllAsRead]);

  const badgeDisplay = unreadCount > 99 ? "99+" : unreadCount;
  const badgeAriaLabel = `${badgeDisplay} ${t.notifications.unread}`;

  return (
    <div className="notification-center" ref={dropdownRef}>
      <button
        className="nav-action-btn notification-trigger"
        onClick={toggleOpen}
        aria-label={t.notifications.title}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <BellIcon size={16} />
        {unreadCount > 0 && (
          <span className="notification-badge" aria-label={badgeAriaLabel}>
            {badgeDisplay}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="notification-dropdown" role="menu">
          <div className="notification-header">
            <span className="notification-header-title">{t.notifications.title}</span>
            {unreadCount > 0 && (
              <button
                className="notification-mark-all"
                onClick={handleMarkAllAsRead}
                aria-label={t.notifications.markAllRead}
              >
                <CheckIcon size={14} />
                {t.notifications.markAllRead}
              </button>
            )}
          </div>

          <div className="notification-list">
            {isLoading && notifications.length === 0 && (
              <div className="notification-empty">{t.common.loading}</div>
            )}

            {!isLoading && notifications.length === 0 && (
              <div className="notification-empty">{t.notifications.empty}</div>
            )}

            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkAsRead={handleMarkAsRead}
                onClear={clearNotification}
                onNavigate={handleNavigate}
              />
            ))}
          </div>

          {notifications.length > 0 && (
            <div className="notification-footer">
              <button
                className="notification-view-all"
                onClick={() => handleNavigate("signals")}
              >
                {t.notifications.viewAll}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
