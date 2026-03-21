/**
 * Discovery 頁面的搜尋結果容器。
 */

import { memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DiscoveryRepo } from "../../api/client";
import { DiscoveryResultCard } from "./DiscoveryResultCard";
import { GridIcon, ListIcon } from "../Icons";
import { useI18n } from "../../i18n";
import { normalizeRepoName } from "../../utils/format";
import { useIntersectionObserver } from "../../hooks/useIntersectionObserver";
import type { ViewMode } from "../../hooks/useViewMode";
import styles from "./Discovery.module.css";

export interface WatchlistSignal {
  velocity: number | null;
  trend: number | null;
}

interface DiscoveryResultsProps {
  repos: DiscoveryRepo[];
  totalCount: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  watchlistFullNames: Set<string>;
  watchlistSignalMap?: Map<string, WatchlistSignal>;
  onAddToWatchlist: (repo: DiscoveryRepo) => void;
  onLoadMore: () => void;
  addingRepoId: number | null;
  hasSearched: boolean;
  onViewRepo?: (repo: DiscoveryRepo) => void;
  isSelectionMode?: boolean;
  selectedIds?: Set<number>;
  onToggleSelection?: (id: number) => void;
  onEnterSelectionMode?: () => void;
  onExitSelectionMode?: () => void;
  /** 當 key 變更時觸發淡入動畫（sort/filter 切換） */
  resultsKey?: string;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
}

export const DiscoveryResults = memo(function DiscoveryResults({
  repos,
  totalCount,
  hasMore,
  loading,
  error,
  watchlistFullNames,
  watchlistSignalMap,
  onAddToWatchlist,
  onLoadMore,
  addingRepoId,
  hasSearched,
  onViewRepo,
  isSelectionMode = false,
  selectedIds,
  onToggleSelection,
  onEnterSelectionMode,
  onExitSelectionMode,
  resultsKey,
  viewMode = "list",
  onViewModeChange,
}: DiscoveryResultsProps) {
  const { t } = useI18n();

  // Infinite scroll：sentinel 進入視窗時自動載入下一頁
  const { sentinelRef, isSupported: isIntersectionSupported } = useIntersectionObserver({
    onIntersect: onLoadMore,
    enabled: hasMore && !loading,
  });

  // 錯誤狀態
  if (error) {
    return (
      <div className={styles.emptyState}>
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

  // 初始狀態：尚未搜尋
  if (!hasSearched && repos.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>{t.discovery.empty.startSearch}</p>
      </div>
    );
  }

  // 初次搜尋的載入狀態
  if (loading && repos.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>{t.discovery.searching}</p>
      </div>
    );
  }

  // 搜尋後無結果
  if (hasSearched && repos.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>{t.discovery.empty.noResults}</p>
        <p className={styles.emptyHint}>{t.discovery.empty.tryDifferent}</p>
      </div>
    );
  }

  return (
    <div className={styles.results}>
      <div className={styles.resultsHeader}>
        <span className={styles.resultsCount} role="status" aria-live="polite">
          {t.discovery.results.replace("{count}", totalCount.toLocaleString())}
        </span>
        <div className={styles.resultsHeaderActions}>
          {onViewModeChange && (
            <div className={styles.viewModeToggle}>
              <button
                type="button"
                className={`${styles.viewModeButton} ${viewMode === "list" ? styles.viewModeActive : ""}`}
                onClick={() => onViewModeChange("list")}
                aria-label={t.discovery.viewMode.list}
                title={t.discovery.viewMode.list}
              >
                <ListIcon size={16} />
              </button>
              <button
                type="button"
                className={`${styles.viewModeButton} ${viewMode === "grid" ? styles.viewModeActive : ""}`}
                onClick={() => onViewModeChange("grid")}
                aria-label={t.discovery.viewMode.grid}
                title={t.discovery.viewMode.grid}
              >
                <GridIcon size={16} />
              </button>
            </div>
          )}
          {repos.length > 0 && onEnterSelectionMode && onExitSelectionMode && (
            <button
              type="button"
              className={styles.selectionToggle}
              onClick={isSelectionMode ? onExitSelectionMode : onEnterSelectionMode}
            >
              {isSelectionMode ? t.discovery.batchAdd.cancel : t.discovery.batchAdd.select}
            </button>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={resultsKey ?? "results"}
          className={`${styles.resultsList} ${viewMode === "grid" ? styles.resultsGrid : ""}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {repos.map((repo) => (
            <DiscoveryResultCard
              key={repo.id}
              repo={repo}
              isInWatchlist={watchlistFullNames.has(normalizeRepoName(repo.full_name))}
              onAddToWatchlist={onAddToWatchlist}
              isAdding={addingRepoId === repo.id}
              signal={watchlistSignalMap?.get(normalizeRepoName(repo.full_name))}
              onView={onViewRepo}
              isSelectionMode={isSelectionMode}
              isSelected={selectedIds?.has(repo.id) ?? false}
              onToggleSelection={onToggleSelection}
              compact={viewMode === "grid"}
            />
          ))}
        </motion.div>
      </AnimatePresence>

      {hasMore &&
        (isIntersectionSupported ? (
          <div ref={sentinelRef} className={styles.infiniteScrollSentinel}>
            {loading && <div className={styles.spinner} />}
          </div>
        ) : (
          <div className={styles.loadMoreWrapper}>
            <button className={styles.loadMoreButton} onClick={onLoadMore} disabled={loading}>
              {loading ? t.discovery.searching : t.discovery.loadMore}
            </button>
          </div>
        ))}
    </div>
  );
});
