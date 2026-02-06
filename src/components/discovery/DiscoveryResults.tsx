/**
 * Discovery 頁面的搜尋結果容器。
 */

import { DiscoveryRepo } from "../../api/client";
import { DiscoveryResultCard } from "./DiscoveryResultCard";
import { useI18n } from "../../i18n";
import styles from "./Discovery.module.css";

interface DiscoveryResultsProps {
  repos: DiscoveryRepo[];
  totalCount: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  watchlistFullNames: Set<string>;
  onAddToWatchlist: (repo: DiscoveryRepo) => void;
  onLoadMore: () => void;
  addingRepoId: number | null;
  hasSearched: boolean;
}

export function DiscoveryResults({
  repos,
  totalCount,
  hasMore,
  loading,
  error,
  watchlistFullNames,
  onAddToWatchlist,
  onLoadMore,
  addingRepoId,
  hasSearched,
}: DiscoveryResultsProps) {
  const { t } = useI18n();

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
        <span className={styles.resultsCount}>
          {t.discovery.results.replace("{count}", totalCount.toLocaleString())}
        </span>
      </div>

      <div className={styles.resultsList}>
        {repos.map((repo) => (
          <DiscoveryResultCard
            key={repo.id}
            repo={repo}
            isInWatchlist={watchlistFullNames.has(repo.full_name.toLowerCase())}
            onAddToWatchlist={onAddToWatchlist}
            isAdding={addingRepoId === repo.id}
          />
        ))}
      </div>

      {hasMore && (
        <div className={styles.loadMoreWrapper}>
          <button className={styles.loadMoreButton} onClick={onLoadMore} disabled={loading}>
            {loading ? t.discovery.searching : t.discovery.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}
