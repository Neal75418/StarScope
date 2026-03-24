import { memo } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { XIcon } from "../Icons";
import { useI18n } from "../../i18n";
import type { Notification } from "../../hooks/useNotifications";
import { MS_PER_MINUTE, MS_PER_HOUR, MS_PER_DAY } from "../../utils/format";
import type { Page } from "../../types/navigation";

function shouldMarkAsRead(notification: Notification) {
  return !notification.read;
}

function getTargetPage(notification: Notification): Page | null {
  return notification.link?.page ?? null;
}

function isButtonTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.tagName === "BUTTON";
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

export function formatTimeAgo(timestamp: string, t: ReturnType<typeof useI18n>["t"]): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / MS_PER_MINUTE);
  const diffHours = Math.floor(diffMs / MS_PER_HOUR);
  const diffDays = Math.floor(diffMs / MS_PER_DAY);

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

export const NotificationItem = memo(function NotificationItem({
  notification,
  onMarkAsRead,
  onClear,
  onNavigate,
}: {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onClear: (id: string) => void;
  onNavigate: (page: Page) => void;
}) {
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
    // 目標是按鈕時不處理，讓按鈕自行處理事件
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
    <div className={`notification-item ${notification.read ? "read" : "unread"}`}>
      <div
        className="notification-body"
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-labelledby={`notif-title-${notification.id}`}
        aria-describedby={`notif-msg-${notification.id} notif-time-${notification.id}`}
        onKeyDown={handleKeyDown}
      >
        <div className="notification-icon">{renderNotificationIcon(notification.type)}</div>
        <div className="notification-content">
          <div className="notification-title" id={`notif-title-${notification.id}`}>
            {notification.title}
          </div>
          <div className="notification-message" id={`notif-msg-${notification.id}`}>
            {notification.message}
          </div>
          <div className="notification-time" id={`notif-time-${notification.id}`}>
            {timeAgo}
          </div>
        </div>
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
