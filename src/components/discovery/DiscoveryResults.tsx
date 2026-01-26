/**
 * Results container for Discovery page.
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

  // Error state
  if (error) {
    return (
      <div className={styles.emptyState}>
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

  // Initial state - no search yet
  if (!hasSearched && repos.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>{t.discovery.empty.startSearch}</p>
      </div>
    );
  }

  // Loading state for initial search
  if (loading && repos.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>{t.discovery.searching}</p>
      </div>
    );
  }

  // Empty results after search
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
