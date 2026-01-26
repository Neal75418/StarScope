/**
 * Discovery page - search and explore GitHub repositories.
 * Supports combining: keyword search + time period + language filters.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useI18n } from "../i18n";
import { useDiscovery } from "../hooks/useDiscovery";
import { useToast } from "../components/Toast";
import { AnimatedPage } from "../components/motion";
import { getRepos, addRepo, DiscoveryRepo, RepoWithSignals, SearchFilters } from "../api/client";
import {
  DiscoverySearchBar,
  TrendingFilters,
  TrendingPeriod,
  ActiveFilters,
  DiscoveryFilters,
  DiscoveryResults,
  SavedFilters,
} from "../components/discovery";

// Build combined search query from all active filters
function buildCombinedQuery(
  keyword?: string,
  period?: TrendingPeriod,
  language?: string
): string {
  const parts: string[] = [];

  // Add keyword if present
  if (keyword?.trim()) {
    parts.push(keyword.trim());
  }

  // Add time-based filter if period is selected
  if (period) {
    const now = new Date();
    let dateStr: string;
    let minStars: number;

    switch (period) {
      case "daily":
        now.setDate(now.getDate() - 1);
        dateStr = now.toISOString().split("T")[0];
        minStars = 10;
        break;
      case "weekly":
        now.setDate(now.getDate() - 7);
        dateStr = now.toISOString().split("T")[0];
        minStars = 50;
        break;
      case "monthly":
        now.setDate(now.getDate() - 30);
        dateStr = now.toISOString().split("T")[0];
        minStars = 100;
        break;
    }

    parts.push(`created:>${dateStr}`);
    parts.push(`stars:>=${minStars}`);
  }

  // Add language filter
  if (language) {
    parts.push(`language:${language}`);
  }

  return parts.join(" ");
}

// Convert period string to TrendingPeriod
function stringToPeriod(period: string | undefined): TrendingPeriod | undefined {
  if (period === "daily" || period === "weekly" || period === "monthly") {
    return period;
  }
  return undefined;
}

export function Discovery() {
  const { t } = useI18n();
  const toast = useToast();
  const discovery = useDiscovery();

  // Track watchlist repos to show "In Watchlist" status
  const [watchlist, setWatchlist] = useState<RepoWithSignals[]>([]);
  const [addingRepoId, setAddingRepoId] = useState<number | null>(null);

  // Three independent filters
  const [keyword, setKeyword] = useState<string>("");
  const [activePeriod, setActivePeriod] = useState<TrendingPeriod | undefined>();
  const [hasSearched, setHasSearched] = useState(false);

  // Prevent duplicate fetches
  const hasLoadedWatchlistRef = useRef(false);

  // Load watchlist on mount
  useEffect(() => {
    if (hasLoadedWatchlistRef.current) return;
    hasLoadedWatchlistRef.current = true;

    const loadWatchlist = async () => {
      try {
        const data = await getRepos();
        setWatchlist(data.repos);
      } catch {
        // Silently fail - not critical for discovery
      }
    };
    void loadWatchlist();
  }, []);

  // Create a Set of watchlist full_names for quick lookup
  const watchlistFullNames = useMemo(
    () => new Set(watchlist.map((r) => r.full_name.toLowerCase())),
    [watchlist]
  );

  // Execute search with current filters
  const executeSearch = useCallback(
    (kw: string, period: TrendingPeriod | undefined, lang: string | undefined) => {
      const query = buildCombinedQuery(kw, period, lang);
      if (query) {
        setHasSearched(true);
        void discovery.search(query, discovery.filters);
      }
    },
    [discovery]
  );

  // Handle keyword search
  const handleSearch = useCallback(
    (query: string) => {
      setKeyword(query);
      executeSearch(query, activePeriod, discovery.filters.language);
    },
    [activePeriod, discovery.filters.language, executeSearch]
  );

  // Handle trending period selection
  const handlePeriodSelect = useCallback(
    (period: TrendingPeriod) => {
      setActivePeriod(period);
      executeSearch(keyword, period, discovery.filters.language);
    },
    [keyword, discovery.filters.language, executeSearch]
  );

  // Handle filter change (language/sort)
  const handleFiltersChange = useCallback(
    (filters: typeof discovery.filters) => {
      discovery.setFilters(filters);
      // Re-search if we have any active filter
      if (keyword || activePeriod || filters.language) {
        executeSearch(keyword, activePeriod, filters.language);
      }
    },
    [discovery, keyword, activePeriod, executeSearch]
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

  // Handle removing keyword filter
  const handleRemoveKeyword = useCallback(() => {
    setKeyword("");
    if (activePeriod || discovery.filters.language) {
      executeSearch("", activePeriod, discovery.filters.language);
    } else {
      discovery.reset();
      setHasSearched(false);
    }
  }, [activePeriod, discovery, executeSearch]);

  // Handle removing active period filter
  const handleRemovePeriod = useCallback(() => {
    setActivePeriod(undefined);
    if (keyword || discovery.filters.language) {
      executeSearch(keyword, undefined, discovery.filters.language);
    } else {
      discovery.reset();
      setHasSearched(false);
    }
  }, [keyword, discovery, executeSearch]);

  // Handle removing active language filter
  const handleRemoveLanguage = useCallback(() => {
    const newFilters = { ...discovery.filters, language: undefined };
    discovery.setFilters(newFilters);
    if (keyword || activePeriod) {
      executeSearch(keyword, activePeriod, undefined);
    } else {
      discovery.reset();
      setHasSearched(false);
    }
  }, [keyword, activePeriod, discovery, executeSearch]);

  // Handle clearing all filters
  const handleClearAll = useCallback(() => {
    setKeyword("");
    setActivePeriod(undefined);
    discovery.reset();
    setHasSearched(false);
  }, [discovery]);

  // Handle applying a saved filter
  const handleApplySavedFilter = useCallback(
    (query: string, period: string | undefined, filters: SearchFilters) => {
      setKeyword(query);
      const trendingPeriod = stringToPeriod(period);
      setActivePeriod(trendingPeriod);
      discovery.setFilters(filters);

      // Execute search with the saved filter
      if (query || trendingPeriod || filters.language) {
        const combinedQuery = buildCombinedQuery(query, trendingPeriod, filters.language);
        if (combinedQuery) {
          setHasSearched(true);
          void discovery.search(combinedQuery, filters);
        }
      }
    },
    [discovery]
  );

  // Handle adding repo to watchlist
  const handleAddToWatchlist = useCallback(
    async (repo: DiscoveryRepo) => {
      setAddingRepoId(repo.id);
      try {
        const newRepo = await addRepo({ owner: repo.owner, name: repo.name });
        setWatchlist((prev) => [...prev, newRepo]);
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
        onSearch={handleSearch}
        loading={discovery.loading}
        initialQuery={keyword}
      />

      <div className="discovery-toolbar">
        <TrendingFilters onSelectPeriod={handlePeriodSelect} activePeriod={activePeriod} />
        <SavedFilters
          currentQuery={keyword}
          currentPeriod={activePeriod}
          currentFilters={discovery.filters}
          onApply={handleApplySavedFilter}
        />
      </div>

      <ActiveFilters
        keyword={keyword || undefined}
        period={activePeriod ? getPeriodLabel(activePeriod) : undefined}
        language={discovery.filters.language}
        onRemoveKeyword={handleRemoveKeyword}
        onRemovePeriod={handleRemovePeriod}
        onRemoveLanguage={handleRemoveLanguage}
        onClearAll={handleClearAll}
      />

      <DiscoveryFilters filters={discovery.filters} onFiltersChange={handleFiltersChange} />

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
        hasSearched={hasSearched}
      />
    </AnimatedPage>
  );
}
