/**
 * Discovery page - search and explore GitHub repositories.
 * Supports combining: keyword search + time period + language filters.
 */

import { useState, useCallback, useMemo } from "react";
import { useI18n } from "../i18n";
import { useDiscovery } from "../hooks/useDiscovery";
import { useWatchlist } from "../hooks/useWatchlist";
import { useToast } from "../components/Toast";
import { AnimatedPage } from "../components/motion";
import { addRepo, DiscoveryRepo } from "../api/client";
import {
  DiscoverySearchBar,
  TrendingFilters,
  TrendingPeriod,
  ActiveFilters,
  DiscoveryFilters,
  DiscoveryResults,
  SavedFilters,
} from "../components/discovery";

export function Discovery() {
  const { t } = useI18n();
  const toast = useToast();
  const discovery = useDiscovery();
  const { repos: watchlist, handleRefreshAll } = useWatchlist();

  const [addingRepoId, setAddingRepoId] = useState<number | null>(null);
  // Track locally added repo names for immediate UI feedback
  const [locallyAdded, setLocallyAdded] = useState<Set<string>>(new Set());

  // Create a Set of watchlist full_names for quick lookup (includes locally added)
  const watchlistFullNames = useMemo(() => {
    const names = new Set(watchlist.map((r) => r.full_name.toLowerCase()));
    locallyAdded.forEach((name) => names.add(name));
    return names;
  }, [watchlist, locallyAdded]);

  // Get period display label for active filters
  const getPeriodLabel = useCallback(
    (period: TrendingPeriod): string => {
      switch (period) {
        case "daily":
          return t.discovery.trending.today;
        case "weekly":
          return t.discovery.trending.thisWeek;
        case "monthly":
          return t.discovery.trending.thisMonth;
      }
    },
    [t.discovery.trending]
  );

  // Handle clearing all filters
  const handleClearAll = useCallback(() => {
    discovery.reset();
  }, [discovery]);

  // Handle adding repo to watchlist
  const handleAddToWatchlist = useCallback(
    async (repo: DiscoveryRepo) => {
      setAddingRepoId(repo.id);
      try {
        await addRepo({ owner: repo.owner, name: repo.name });
        // Immediately update local state for UI feedback
        setLocallyAdded((prev) => new Set(prev).add(repo.full_name.toLowerCase()));
        // Refresh watchlist in background to sync with backend
        void handleRefreshAll();
        toast.success(t.toast.repoAdded);
      } catch {
        toast.error(t.toast.error);
      } finally {
        setAddingRepoId(null);
      }
    },
    [toast, t.toast.repoAdded, t.toast.error, handleRefreshAll]
  );

  return (
    <AnimatedPage className="page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.discovery.title}</h1>
        <p className="subtitle">{t.discovery.subtitle}</p>
      </header>

      <DiscoverySearchBar
        onSearch={discovery.setKeyword}
        loading={discovery.loading}
        initialQuery={discovery.keyword}
      />

      <div className="discovery-toolbar">
        <TrendingFilters onSelectPeriod={discovery.setPeriod} activePeriod={discovery.period} />
        <SavedFilters
          currentQuery={discovery.keyword}
          currentPeriod={discovery.period}
          currentFilters={discovery.filters}
          onApply={discovery.applySavedFilter}
        />
      </div>

      <ActiveFilters
        keyword={discovery.keyword || undefined}
        period={discovery.period ? getPeriodLabel(discovery.period) : undefined}
        language={discovery.filters.language}
        onRemoveKeyword={discovery.removeKeyword}
        onRemovePeriod={discovery.removePeriod}
        onRemoveLanguage={discovery.removeLanguage}
        onClearAll={handleClearAll}
      />

      <DiscoveryFilters filters={discovery.filters} onFiltersChange={discovery.setFilters} />

      <DiscoveryResults
        repos={discovery.repos}
        totalCount={discovery.totalCount}
        hasMore={discovery.hasMore}
        loading={discovery.loading}
        error={discovery.error}
        watchlistFullNames={watchlistFullNames}
        onAddToWatchlist={handleAddToWatchlist}
        onLoadMore={discovery.loadMore}
        addingRepoId={addingRepoId}
        hasSearched={discovery.hasSearched}
      />
    </AnimatedPage>
  );
}
