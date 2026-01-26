/**
 * Context badges showing HN, Reddit, and release information.
 */

import { ContextBadge } from "../api/client";
import { useI18n } from "../i18n";

interface ContextBadgesProps {
  badges: ContextBadge[];
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

const BADGE_CONFIG: Record<string, { bg: string; icon: string }> = {
  hn: { bg: "#ff6600", icon: "Y" },
  reddit: { bg: "#ff4500", icon: "r/" },
  release: { bg: "#238636", icon: "v" },
};

export function ContextBadges({ badges, onRefresh, isRefreshing }: ContextBadgesProps) {
  const { t } = useI18n();

  return (
    <div className="context-badges">
      {badges.map((badge) => {
        const config = BADGE_CONFIG[badge.type] || { bg: "#666", icon: "?" };
        return (
          <a
            key={badge.url}
            href={badge.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`context-badge ${badge.is_recent ? "recent" : ""}`}
            style={{ backgroundColor: config.bg }}
            title={badge.label}
          >
            <span className="badge-icon">{config.icon}</span>
            <span className="badge-label">{badge.label}</span>
          </a>
        );
      })}
      {onRefresh && (
        <button
          className="context-refresh-btn"
          onClick={onRefresh}
          disabled={isRefreshing}
          title={t.repo.refreshContext ?? "Refresh Context"}
        >
          {isRefreshing ? "↻" : "⟳"}
        </button>
      )}
    </div>
  );
}
