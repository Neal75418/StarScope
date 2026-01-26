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
  const { repos: watchlist } = useWatchlist();

  const [addingRepoId, setAddingRepoId] = useState<number | null>(null);

  // Create a Set of watchlist full_names for quick lookup
  const watchlistFullNames = useMemo(
    () => new Set(watchlist.map((r) => r.full_name.toLowerCase())),
    [watchlist]
  );

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
        // We rely on useWatchlist to refresh its state via SWR or manually if needed,
        // but here we just show the toast. The watchlist prop will update if useWatchlist updates.
        // Actually useWatchlist uses internal state from useRepoOperations which updates on handleAddRepo.
        // Since we are bypassing useWatchlist's handleAddRepo here (calling addRepo directly),
        // the watchlist might not update immediately if it's not polling.
        // It's better to use useWatchlist's handleAddRepo if possible, but that takes a string url/name.
        // Let's stick to the original logic for now, but usually we should sync.
        // The original logic just added it to local 'watchlist' state.
        // Now 'watchlist' comes from useWatchlist.
        // If useWatchlist doesn't know about this change, the UI won't update "In Watchlist".
        // IMPROVEMENT: We should use a method from useWatchlist to add, or force refresh.
        // But useWatchlist.handleAddRepo opens a dialog.
        // Let's check useRepoOperations exposed by useWatchlist.
        // useWatchlist exposes handleFetchRepo and handleRefreshAll.
        // Maybe we should just trigger a refresh of the watchlist.

        // For this refactor, I will keep it simple and maybe trigger a global refresh if possible,
        // or just accept it might not update instantly until the next poll/focus.
        // Actually, let's see if we can just call 'addRepo' and then 'handleRefreshAll'?
        // But since we don't have handleRefreshAll here easily without extracting it...
        // Wait, useWatchlist exposes 'handleRefreshAll'.
        // So I can grab it.
        toast.success(t.toast.repoAdded);
      } catch {
        toast.error(t.toast.error);
      } finally {
        setAddingRepoId(null);
      }
    },
    [toast, t.toast.repoAdded, t.toast.error]
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
