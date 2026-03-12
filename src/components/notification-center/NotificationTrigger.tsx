import { BellIcon } from "../Icons";
import { useI18n } from "../../i18n";

function formatBadge(unreadCount: number) {
  if (unreadCount <= 0) {
    return null;
  }
  return unreadCount > 99 ? "99+" : String(unreadCount);
}

export function NotificationTrigger({
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
