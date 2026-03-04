/**
 * 個人化推薦區塊，顯示在 Discovery 頁面頂部。
 * 支援 View More / Show Less、Dismiss、Add to Watchlist。
 */

import React, { memo, useState, useCallback, useMemo } from "react";
import { useI18n } from "../../i18n";
import { usePersonalizedRecs } from "../../hooks/usePersonalizedRecs";
import { useDismissedRecs } from "../../hooks/useDismissedRecs";
import { Skeleton } from "../Skeleton";
import { formatNumber, formatDelta } from "../../utils/format";
import { safeOpenUrl } from "../../utils/url";
import type { PersonalizedRecommendation } from "../../api/types";

const TREND_ICON: Record<number, string> = {
  1: "↑",
  0: "→",
  [-1]: "↓",
};

const INITIAL_DISPLAY_COUNT = 6;

function buildReason(rec: PersonalizedRecommendation, t: ReturnType<typeof useI18n>["t"]): string {
  const r = t.discovery.recommendations;
  const parts: string[] = [r.similarTo.replace("{repo}", rec.source_repo_name)];
  if (rec.shared_topics.length > 0) {
    parts.push(r.topics.replace("{topics}", rec.shared_topics.join(", ")));
  }
  if (rec.same_language) {
    parts.push(r.sameLanguage);
  }
  return parts.join(" · ");
}

const RecCard = memo(function RecCard({
  rec,
  t,
  onDismiss,
  isInWatchlist,
  onAddToWatchlist,
  isAdding,
}: {
  rec: PersonalizedRecommendation;
  t: ReturnType<typeof useI18n>["t"];
  onDismiss: (repoId: number) => void;
  isInWatchlist?: boolean;
  onAddToWatchlist?: (rec: PersonalizedRecommendation) => void;
  isAdding?: boolean;
}) {
  const handleClick = useCallback(() => {
    void safeOpenUrl(rec.url);
  }, [rec.url]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDismiss(rec.repo_id);
    },
    [rec.repo_id, onDismiss]
  );

  const handleAddToWatchlist = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onAddToWatchlist?.(rec);
    },
    [rec, onAddToWatchlist]
  );

  return (
    <div
      role="link"
      tabIndex={0}
      className="rec-card"
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleClick();
      }}
    >
      <button
        className="rec-dismiss-btn"
        onClick={handleDismiss}
        aria-label={t.discovery.recommendations.dismiss}
        title={t.discovery.recommendations.dismiss}
      >
        ×
      </button>
      <div className="rec-card-header">
        <span className="rec-card-name">{rec.full_name}</span>
        {rec.language && <span className="rec-card-lang">{rec.language}</span>}
      </div>
      {rec.description && <div className="rec-card-desc">{rec.description}</div>}
      <div className="rec-card-metrics">
        {rec.stars != null && <span className="rec-metric">★ {formatNumber(rec.stars)}</span>}
        {rec.velocity != null && (
          <span className="rec-metric">
            {t.discovery.recommendations.velocity}: {formatDelta(rec.velocity)}
          </span>
        )}
        {rec.trend != null && <span className="rec-metric">{TREND_ICON[rec.trend] ?? "→"}</span>}
        <span className="rec-metric rec-similarity">
          {t.discovery.recommendations.matchScore} {Math.round(rec.similarity_score * 100)}%
        </span>
      </div>
      <div className="rec-card-reason">{buildReason(rec, t)}</div>
      {onAddToWatchlist && (
        <div className="rec-card-actions">
          <button
            className={`rec-add-btn ${isInWatchlist ? "rec-add-btn--added" : ""}`}
            onClick={handleAddToWatchlist}
            disabled={isInWatchlist || isAdding}
          >
            {isInWatchlist ? t.discovery.inWatchlist : t.discovery.addToWatchlist}
          </button>
        </div>
      )}
    </div>
  );
});

interface RecommendedForYouProps {
  watchlistFullNames?: Set<string>;
  onAddToWatchlist?: (rec: PersonalizedRecommendation) => void;
  addingRepoId?: number | null;
}

export const RecommendedForYou = memo(function RecommendedForYou({
  watchlistFullNames,
  onAddToWatchlist,
  addingRepoId,
}: RecommendedForYouProps) {
  const { t } = useI18n();
  const { data, isLoading, error } = usePersonalizedRecs(20);
  const { dismissedIds, dismiss } = useDismissedRecs();
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // 過濾掉已 dismiss 的推薦
  const filteredRecs = useMemo(() => {
    if (!data) return [];
    return data.recommendations.filter((rec) => !dismissedIds.has(rec.repo_id));
  }, [data, dismissedIds]);

  const displayedRecs = showAll ? filteredRecs : filteredRecs.slice(0, INITIAL_DISPLAY_COUNT);

  const hasMore = filteredRecs.length > INITIAL_DISPLAY_COUNT;

  if (error) {
    return (
      <div className="rec-section">
        <div className="rec-section-header">
          <h3>{t.discovery.recommendations.title}</h3>
        </div>
        <div className="rec-card-desc">{t.discovery.recommendations.loadError}</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="rec-section">
        <div className="rec-section-header">
          <Skeleton width={200} height={24} />
        </div>
        <div className="rec-grid">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rec-card">
              <Skeleton width="70%" height={16} style={{ marginBottom: 8 }} />
              <Skeleton width="100%" height={12} style={{ marginBottom: 12 }} />
              <Skeleton width="60%" height={14} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data || filteredRecs.length === 0) return null;

  return (
    <div className="rec-section">
      <div className="rec-section-header">
        <div>
          <h3>{t.discovery.recommendations.title}</h3>
          <p className="rec-subtitle">{t.discovery.recommendations.subtitle}</p>
        </div>
        <button className="btn btn-sm rec-toggle" onClick={() => setCollapsed((prev) => !prev)}>
          {collapsed ? "▼" : "▲"}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="rec-grid">
            {displayedRecs.map((rec) => (
              <RecCard
                key={rec.repo_id}
                rec={rec}
                t={t}
                onDismiss={dismiss}
                isInWatchlist={watchlistFullNames?.has(rec.full_name.toLowerCase())}
                onAddToWatchlist={onAddToWatchlist}
                isAdding={addingRepoId === rec.repo_id}
              />
            ))}
          </div>
          {hasMore && (
            <div className="rec-show-more-wrapper">
              <button
                className="btn btn-sm rec-show-more"
                onClick={() => setShowAll((prev) => !prev)}
              >
                {showAll
                  ? t.discovery.recommendations.showLess
                  : t.discovery.recommendations.showMore}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
});
