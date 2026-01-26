import { useState, useCallback, useRef } from "react";
import { SearchFilters, DiscoveryRepo } from "../api/client";
import { buildCombinedQuery, fetchSearchResults } from "../utils/searchHelpers";
import { TrendingPeriod } from "../components/discovery";
import { useI18n } from "../i18n";

export interface DiscoverySearchState {
  repos: DiscoveryRepo[];
  totalCount: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
}

const INITIAL_SEARCH_STATE: DiscoverySearchState = {
  repos: [],
  totalCount: 0,
  hasMore: false,
  loading: false,
  error: null,
};

export function useDiscoverySearch() {
  const { t } = useI18n();
  const [searchState, setSearchState] = useState<DiscoverySearchState>(INITIAL_SEARCH_STATE);
  const isFetchingRef = useRef(false);

  // The core search function
  const executeSearch = useCallback(
    async (
      keyword: string,
      period: TrendingPeriod | undefined,
      filters: SearchFilters,
      page: number = 1
    ) => {
      const query = buildCombinedQuery(keyword, period, filters.language);

      if (!query.trim()) {
        setSearchState(INITIAL_SEARCH_STATE);
        return;
      }

      // Check if we are already fetching exactly this
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;

      setSearchState((prev) => ({
        ...prev,
        loading: true,
        error: null,
        repos: page === 1 ? [] : prev.repos,
      }));

      const result = await fetchSearchResults(query, filters, page, t);

      setSearchState((prev) => ({
        repos: page === 1 ? result.repos : [...prev.repos, ...result.repos],
        totalCount: result.totalCount,
        hasMore: result.hasMore,
        loading: false,
        error: result.error || null,
      }));

      isFetchingRef.current = false;
    },
    [t]
  );

  const resetSearch = useCallback(() => {
    setSearchState(INITIAL_SEARCH_STATE);
  }, []);

  return {
    ...searchState,
    executeSearch,
    resetSearch,
  };
}
