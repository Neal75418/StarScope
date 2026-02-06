/**
 * 探索頁面的搜尋邏輯與狀態管理。
 */

import { useState, useCallback, useRef } from "react";
import { SearchFilters, DiscoveryRepo } from "../api/client";
import { buildCombinedQuery, fetchSearchResults, SearchResult } from "../utils/searchHelpers";
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

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function runSearch(
  query: string,
  filters: SearchFilters,
  page: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any,
  signal: AbortSignal
): Promise<SearchResult | null> {
  try {
    return await fetchSearchResults(query, filters, page, t, signal);
  } catch (err) {
    if (isAbortError(err)) return null;
    return { repos: [], totalCount: 0, hasMore: false, error: t.discovery.error.generic };
  }
}

function toFinishedState(result: SearchResult): Omit<DiscoverySearchState, "repos"> {
  return {
    totalCount: result.totalCount,
    hasMore: result.hasMore,
    loading: false,
    error: result.error || null,
  };
}

export function useDiscoverySearch() {
  const { t } = useI18n();
  const [searchState, setSearchState] = useState<DiscoverySearchState>(INITIAL_SEARCH_STATE);
  const abortControllerRef = useRef<AbortController | null>(null);

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

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setSearchState((prev) => ({
        ...prev,
        loading: true,
        error: null,
        repos: page === 1 ? [] : prev.repos,
      }));

      const result = await runSearch(query, filters, page, t, controller.signal);

      if (!result || controller.signal.aborted) return;

      setSearchState((prev) => ({
        ...toFinishedState(result),
        repos: page === 1 ? result.repos : [...prev.repos, ...result.repos],
      }));
    },
    [t]
  );

  const resetSearch = useCallback(() => {
    abortControllerRef.current?.abort();
    setSearchState(INITIAL_SEARCH_STATE);
  }, []);

  return {
    ...searchState,
    executeSearch,
    resetSearch,
  };
}
