import { BellIcon, CheckIcon } from "../Icons";
import { useI18n } from "../../i18n";
import { Notification } from "../../hooks/useNotifications";
import { NotificationItem } from "./NotificationItem";
import type { Page } from "../../types/navigation";

interface NotificationDropdownProps {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  onMarkAllAsRead: () => void;
  onNavigate: (page: Page) => void;
  onClear: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  t: ReturnType<typeof useI18n>["t"];
}

export function NotificationDropdown({
  notifications,
  unreadCount,
  isLoading,
  onMarkAllAsRead,
  onNavigate,
  onClear,
  onMarkAsRead,
  t,
}: NotificationDropdownProps) {
  const isEmpty = notifications.length === 0;
  const showLoading = isLoading && isEmpty;
  const showEmpty = !isLoading && isEmpty;
  const showFooter = !isEmpty;

  return (
    <div className="notification-dropdown" role="region" aria-label={t.notifications.title}>
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

        {showEmpty && (
          <div className="notification-empty">
            <span className="notification-empty-icon" aria-hidden="true">
              <BellIcon size={32} />
            </span>
            <span className="notification-empty-text">{t.notifications.empty}</span>
          </div>
        )}

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
