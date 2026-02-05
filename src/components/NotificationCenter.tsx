/**
 * Notification center dropdown component.
 * Shows in-app notifications with unread badge.
 */

import { useEffect, useRef, memo, useCallback } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { BellIcon, CheckIcon, XIcon } from "./Icons";
import { useI18n } from "../i18n";
import { Notification, useNotifications } from "../hooks/useNotifications";

type Page = "dashboard" | "discovery" | "watchlist" | "trends" | "settings";

interface NotificationCenterProps {
  onNavigate: (page: Page) => void;
}

function shouldMarkAsRead(notification: Notification) {
  return !notification.read;
}

function getTargetPage(notification: Notification): Page | null {
  return notification.link?.page ?? null;
}

function isButtonTarget(target: EventTarget | null): boolean {
  return (target as HTMLElement | null)?.tagName === "BUTTON";
}

function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

function renderNotificationIcon(type: Notification["type"]) {
  switch (type) {
    case "alert":
      return <span className="notification-type alert">!</span>;
    case "signal":
      return <span className="notification-type signal">⚡</span>;
    case "system":
      return <span className="notification-type system">ℹ</span>;
    default:
      return null;
  }
}

const NotificationItem = memo(
  ({
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
      if (shouldMarkAsRead(notification)) {
        onMarkAsRead(notification.id);
      }
      const targetPage = getTargetPage(notification);
      if (targetPage) {
        onNavigate(targetPage);
      }
    };

    const handleClear = (e: ReactMouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onClear(notification.id);
    };

    const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
      // Don't handle if the target is a button (let button handle its own events)
      if (isButtonTarget(e.target)) {
        return;
      }

      if (!isActivationKey(e.key)) {
        return;
      }

      e.preventDefault();
      handleClick();
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
        <div className="notification-icon">{renderNotificationIcon(notification.type)}</div>
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
  }
);
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

function formatBadge(unreadCount: number) {
  if (unreadCount <= 0) {
    return null;
  }
  return unreadCount > 99 ? "99+" : String(unreadCount);
}

function NotificationTrigger({
  isOpen,
  unreadCount,
  onToggle,
  t,
}: {
  isOpen: boolean;
  unreadCount: number;
  onToggle: () => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const badgeDisplay = formatBadge(unreadCount);
  const badgeAriaLabel = badgeDisplay ? `${badgeDisplay} ${t.notifications.unread}` : undefined;

  return (
    <button
      className="nav-action-btn notification-trigger"
      onClick={onToggle}
      aria-label={t.notifications.title}
      aria-expanded={isOpen}
      aria-haspopup="true"
    >
      <BellIcon size={16} />
      {badgeDisplay && (
        <span className="notification-badge" aria-label={badgeAriaLabel}>
          {badgeDisplay}
        </span>
      )}
    </button>
  );
}

function NotificationDropdown({
  notifications,
  unreadCount,
  isLoading,
  onMarkAllAsRead,
  onNavigate,
  onClear,
  onMarkAsRead,
  t,
}: {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  onMarkAllAsRead: () => void;
  onNavigate: (page: Page) => void;
  onClear: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const isEmpty = notifications.length === 0;
  const showLoading = isLoading && isEmpty;
  const showEmpty = !isLoading && isEmpty;
  const showFooter = !isEmpty;

  return (
    <div className="notification-dropdown" role="menu">
      <div className="notification-header">
        <span className="notification-header-title">{t.notifications.title}</span>
        {unreadCount > 0 && (
          <button
            className="notification-mark-all"
            onClick={onMarkAllAsRead}
            aria-label={t.notifications.markAllRead}
          >
            <CheckIcon size={14} />
            {t.notifications.markAllRead}
          </button>
        )}
      </div>

      <div className="notification-list">
        {showLoading && <div className="notification-empty">{t.common.loading}</div>}

        {showEmpty && <div className="notification-empty">{t.notifications.empty}</div>}

        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onMarkAsRead={onMarkAsRead}
            onClear={onClear}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      {showFooter && (
        <div className="notification-footer">
          <button className="notification-view-all" onClick={() => onNavigate("dashboard")}>
            {t.notifications.viewAll}
          </button>
        </div>
      )}
    </div>
  );
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
