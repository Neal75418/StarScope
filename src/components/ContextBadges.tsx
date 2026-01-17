/**
 * Context badges showing HN, Reddit, and release information.
 */

import { ContextBadge } from "../api/client";

interface ContextBadgesProps {
  badges: ContextBadge[];
}

const BADGE_CONFIG: Record<string, { bg: string; icon: string }> = {
  hn: { bg: "#ff6600", icon: "Y" },
  reddit: { bg: "#ff4500", icon: "r/" },
  release: { bg: "#238636", icon: "v" },
};

export function ContextBadges({ badges }: ContextBadgesProps) {
  if (badges.length === 0) return null;

  return (
    <div className="context-badges">
      {badges.map((badge, index) => {
        const config = BADGE_CONFIG[badge.type] || { bg: "#666", icon: "?" };
        return (
          <a
            key={index}
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
    </div>
  );
}
