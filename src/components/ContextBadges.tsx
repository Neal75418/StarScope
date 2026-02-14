/**
 * 情境徽章，顯示 Hacker News 相關資訊。
 * 點擊徽章可展開顯示討論詳情。
 */

import React, { useState, useCallback } from "react";
import { safeOpenUrl } from "../utils/url";
import { ContextBadge, ContextSignal, getContextSignals } from "../api/client";
import { useI18n } from "../i18n";
import { MS_PER_DAY } from "../utils/format";
import { logger } from "../utils/logger";

interface ContextBadgesProps {
  badges: ContextBadge[];
  repoId?: number;
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

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / MS_PER_DAY);

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "1d ago";
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function HnDiscussionPanel({ signals, loading }: { signals: ContextSignal[]; loading: boolean }) {
  const { t } = useI18n();

  const handleOpenUrl = async (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    await safeOpenUrl(url);
  };

  if (loading) {
    return (
      <div className="hn-panel">
        <div className="hn-panel-loading">{t.repo.loadingBadges}</div>
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <div className="hn-panel">
        <div className="hn-panel-empty">{t.contextBadges.noDiscussions}</div>
      </div>
    );
  }

  return (
    <div className="hn-panel">
      {signals.map((signal) => (
        <div key={signal.id} className="hn-discussion-item">
          <a
            href={signal.url}
            onClick={(e) => handleOpenUrl(e, signal.url)}
            className="hn-discussion-title"
          >
            {signal.title || "Untitled"}
          </a>
          <div className="hn-discussion-meta">
            {signal.score != null && <span className="hn-meta-item">▲ {signal.score}</span>}
            {signal.comment_count != null && (
              <span className="hn-meta-item">💬 {signal.comment_count}</span>
            )}
            {signal.author && <span className="hn-meta-item hn-meta-author">{signal.author}</span>}
            {signal.published_at && (
              <span className="hn-meta-item">{formatTimeAgo(signal.published_at)}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ContextBadges({ badges, repoId }: ContextBadgesProps) {
  const [expanded, setExpanded] = useState(false);
  const [signals, setSignals] = useState<ContextSignal[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalsFetched, setSignalsFetched] = useState(false);

  const toggleExpand = useCallback(async () => {
    if (!repoId) return;

    if (!expanded && !signalsFetched) {
      setSignalsLoading(true);
      try {
        const res = await getContextSignals(repoId, "hn");
        setSignals(res.signals);
      } catch (err) {
        logger.warn("[ContextBadges] 上下文訊號抓取失敗:", err);
        setSignals([]);
      } finally {
        setSignalsLoading(false);
        setSignalsFetched(true);
      }
    }
    setExpanded((prev) => !prev);
  }, [expanded, signalsFetched, repoId]);

  if (badges.length === 0) return null;

  return (
    <div className="context-badges-container">
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
            <button
              key={badge.url}
              type="button"
              className={`context-badge context-badge-${badge.type} ${badge.is_recent ? "recent" : ""} ${repoId ? "expandable" : ""}`}
              style={{ "--badge-color": config.color } as React.CSSProperties}
              title={`${config.tooltip}: ${badge.label}`}
              onClick={repoId ? toggleExpand : undefined}
            >
              <span className="badge-icon">{config.icon}</span>
              {config.label && <span className="badge-label">{config.label}</span>}
              <span className="badge-value">{value}</span>
              {repoId && <span className="badge-expand-arrow">{expanded ? "▾" : "▸"}</span>}
            </button>
          );
        })}
      </div>

      {expanded && <HnDiscussionPanel signals={signals} loading={signalsLoading} />}
    </div>
  );
}
