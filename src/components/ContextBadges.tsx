/**
 * Context badges showing HN, Reddit, and release information.
 */

import { ContextBadge } from "../api/client";

interface ContextBadgesProps {
  badges: ContextBadge[];
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

const BADGE_CONFIG: Record<
  string,
  { icon: string; label: string; color: string; tooltip: string }
> = {
  hn: { icon: "🔶", label: "HN", color: "#ff6600", tooltip: "Hacker News 討論分數" },
  reddit: { icon: "💬", label: "Reddit", color: "#ff4500", tooltip: "Reddit 討論熱度" },
  release: { icon: "🏷️", label: "", color: "#238636", tooltip: "最新發布版本" },
};

function formatValue(badge: ContextBadge): string {
  if (badge.type === "hn") {
    const match = badge.label.match(/(\d+)/);
    if (match) return match[1];
  } else if (badge.type === "reddit") {
    const match = badge.label.match(/(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      return num >= 1000 ? (num / 1000).toFixed(1) + "k" : match[1];
    }
  } else if (badge.type === "release") {
    const match = badge.label.match(/(v[\d.]+)/);
    if (match) return match[1];
  }
  return badge.label;
}

export function ContextBadges({ badges }: ContextBadgesProps) {
  if (badges.length === 0) return null;

  return (
    <div className="context-badges">
      {badges.map((badge) => {
        const config = BADGE_CONFIG[badge.type] || {
          icon: "❓",
          label: "?",
          color: "#666",
          tooltip: badge.label,
        };
        const value = formatValue(badge);

        return (
          <a
            key={badge.url}
            href={badge.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`context-badge context-badge-${badge.type} ${badge.is_recent ? "recent" : ""}`}
            style={{ "--badge-color": config.color } as React.CSSProperties}
            title={`${config.tooltip}: ${badge.label}`}
          >
            <span className="badge-icon">{config.icon}</span>
            {config.label && <span className="badge-label">{config.label}</span>}
            <span className="badge-value">{value}</span>
          </a>
        );
      })}
    </div>
  );
}
