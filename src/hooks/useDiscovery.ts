/**
 * Hook for Discovery page - searching GitHub repositories.
 */

import { useCallback, useState } from "react";
import { SearchFilters } from "../api/client";
import { TrendingPeriod } from "../components/discovery";
import { useDiscoverySearch } from "./useDiscoverySearch";

export type SortOption = "stars" | "forks" | "updated";

export interface DiscoveryState {
  // Filter state
  keyword: string;
  period: TrendingPeriod | undefined;
  filters: SearchFilters;
  // UI state
  hasSearched: boolean;
}

const INITIAL_STATE: DiscoveryState = {
  keyword: "",
  period: undefined,
  filters: {},
  hasSearched: false,
};

export function useDiscovery() {
  const { repos, totalCount, hasMore, loading, error, executeSearch, resetSearch } =
    useDiscoverySearch();
  const [state, setState] = useState<DiscoveryState>(INITIAL_STATE);

  // Helper to trigger a new search (resets page to 1)
  const search = useCallback(
    (kw: string, p: TrendingPeriod | undefined, f: SearchFilters) => {
      setState({ keyword: kw, period: p, filters: f, hasSearched: true });
      void executeSearch(kw, p, f, 1);
    },
    [executeSearch]
  );

  // Setters that trigger search
  const setKeyword = useCallback(
    (kw: string) => {
      search(kw, state.period, state.filters);
    },
    [state.period, state.filters, search]
  );

  const setPeriod = useCallback(
    (p: TrendingPeriod | undefined) => {
      search(state.keyword, p, state.filters);
    },
    [state.keyword, state.filters, search]
  );

  const setFilters = useCallback(
    (f: SearchFilters) => {
      search(state.keyword, state.period, f);
    },
    [state.keyword, state.period, search]
  );

  const loadMore = useCallback(() => {
    if (hasMore && !loading) {
      // Calculate next page based on current count (assuming 30 per page or similar)
      const nextPage = Math.floor(repos.length / 30) + 1;
      void executeSearch(state.keyword, state.period, state.filters, nextPage);
    }
  }, [hasMore, loading, repos.length, state.keyword, state.period, state.filters, executeSearch]);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
    resetSearch();
  }, [resetSearch]);

  // Utility actions for specific filter removals
  const removeKeyword = useCallback(() => setKeyword(""), [setKeyword]);
  const removePeriod = useCallback(() => setPeriod(undefined), [setPeriod]);
  const removeLanguage = useCallback(() => {
    setFilters({ ...state.filters, language: undefined });
  }, [state.filters, setFilters]);

  // Apply a saved filter set
  const applySavedFilter = useCallback(
    (kw: string, p: TrendingPeriod | undefined, f: SearchFilters) => {
      search(kw, p, f);
    },
    [search]
  );

  return {
    repos,
    totalCount,
    hasMore,
    loading,
    error,
    keyword: state.keyword,
    period: state.period,
    filters: state.filters,
    hasSearched: state.hasSearched,
    setKeyword,
    setPeriod,
    setFilters,
    removeKeyword,
    removePeriod,
    removeLanguage,
    reset,
    loadMore,
    applySavedFilter,
  };
}
