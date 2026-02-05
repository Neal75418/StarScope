/**
 * Context badges showing HN information.
 */

import React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
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
};

function formatValue(badge: ContextBadge): string {
  if (badge.type === "hn") {
    const match = badge.label.match(/(\d+)/);
    if (match) return match[1];
  }
  return badge.label;
}

export function ContextBadges({ badges }: ContextBadgesProps) {
  if (badges.length === 0) return null;

  const handleLinkClick = async (e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    e.preventDefault();
    await openUrl(url);
  };

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
            onClick={(e) => handleLinkClick(e, badge.url)}
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
