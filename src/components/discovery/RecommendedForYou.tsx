/**
 * 個人化推薦區塊，顯示在 Discovery 頁面頂部。
 * 支援 View More / Show Less、Dismiss、Add to Watchlist。
 */

import React, { memo, useState, useCallback, useMemo } from "react";
import { useI18n } from "../../i18n";
import { usePersonalizedRecs } from "../../hooks/usePersonalizedRecs";
import { useDismissedRecs } from "../../hooks/useDismissedRecs";
import { Skeleton } from "../Skeleton";
import { formatNumber, formatDelta, normalizeRepoName } from "../../utils/format";
import { safeOpenUrl } from "../../utils/url";
import { TREND_ARROWS } from "../../constants/trends";
import type { PersonalizedRecommendation } from "../../api/types";
import styles from "./Discovery.module.css";

const INITIAL_DISPLAY_COUNT = 6;
// 多 fetch 一些推薦，以便 dismiss 後仍有足夠項目可顯示
const FETCH_LIMIT = 20;

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
      className={styles.recCard}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleClick();
      }}
    >
      <button
        className={styles.recDismissBtn}
        onClick={handleDismiss}
        aria-label={t.discovery.recommendations.dismiss}
        title={t.discovery.recommendations.dismiss}
      >
        ×
      </button>
      <div className={styles.recCardHeader}>
        <span className={styles.recCardName}>{rec.full_name}</span>
        {rec.language && <span className={styles.recCardLang}>{rec.language}</span>}
      </div>
      {rec.description && <div className={styles.recCardDesc}>{rec.description}</div>}
      <div className={styles.recCardMetrics}>
        {rec.stars != null && <span className={styles.recMetric}>★ {formatNumber(rec.stars)}</span>}
        {rec.velocity != null && (
          <span className={styles.recMetric}>
            {t.discovery.recommendations.velocity}: {formatDelta(rec.velocity)}
          </span>
        )}
        {rec.trend != null && (
          <span className={styles.recMetric}>{TREND_ARROWS[rec.trend] ?? "→"}</span>
        )}
        <span className={`${styles.recMetric} ${styles.recSimilarity}`}>
          {t.discovery.recommendations.matchScore} {Math.round(rec.similarity_score * 100)}%
        </span>
      </div>
      <div className={styles.recCardReason}>{buildReason(rec, t)}</div>
      {onAddToWatchlist && (
        <div className={styles.recCardActions}>
          <button
            className={`${styles.addButton} ${isInWatchlist ? styles.inWatchlist : ""}`}
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
  const { data, isLoading, error } = usePersonalizedRecs(FETCH_LIMIT);
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
      <div className={styles.recSection}>
        <div className={styles.recSectionHeader}>
          <h3>{t.discovery.recommendations.title}</h3>
        </div>
        <div className={styles.recCardDesc}>{t.discovery.recommendations.loadError}</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={styles.recSection}>
        <div className={styles.recSectionHeader}>
          <Skeleton width={200} height={24} />
        </div>
        <div className={styles.recGrid}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={styles.recCard}>
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
    <div className={styles.recSection}>
      <div className={styles.recSectionHeader}>
        <div>
          <h3>{t.discovery.recommendations.title}</h3>
          <p className={styles.recSubtitle}>{t.discovery.recommendations.subtitle}</p>
        </div>
        <button
          className={`btn btn-sm ${styles.recToggle}`}
          onClick={() => setCollapsed((prev) => !prev)}
        >
          {collapsed ? "▼" : "▲"}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className={styles.recGrid}>
            {displayedRecs.map((rec) => (
              <RecCard
                key={rec.repo_id}
                rec={rec}
                t={t}
                onDismiss={dismiss}
                isInWatchlist={watchlistFullNames?.has(normalizeRepoName(rec.full_name))}
                onAddToWatchlist={onAddToWatchlist}
                isAdding={addingRepoId === rec.repo_id}
              />
            ))}
          </div>
          {hasMore && (
            <div className={styles.recShowMoreWrapper}>
              <button
                className={`btn btn-sm ${styles.recShowMore}`}
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
