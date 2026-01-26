/**
 * Hook for Discovery page - searching GitHub repositories.
 */

import { useState, useCallback, useRef } from "react";
import { searchRepos, DiscoveryRepo, SearchFilters, ApiError } from "../api/client";
import { useI18n } from "../i18n";

export type SortOption = "stars" | "forks" | "updated";

export interface DiscoveryState {
  query: string;
  repos: DiscoveryRepo[];
  totalCount: number;
  page: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  filters: SearchFilters;
}

const INITIAL_STATE: DiscoveryState = {
  query: "",
  repos: [],
  totalCount: 0,
  page: 1,
  hasMore: false,
  loading: false,
  error: null,
  filters: {},
};

export function useDiscovery() {
  const { t } = useI18n();
  const [state, setState] = useState<DiscoveryState>(INITIAL_STATE);

  // Prevent duplicate fetches from StrictMode
  const isFetchingRef = useRef(false);

  const search = useCallback(
    async (query: string, filters: SearchFilters = {}, page: number = 1) => {
      if (!query.trim()) {
        setState(INITIAL_STATE);
        return;
      }

      // Skip if already fetching
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;

      setState((prev) => ({
        ...prev,
        query,
        filters,
        page,
        loading: true,
        error: null,
        // Clear repos if new search (page 1)
        repos: page === 1 ? [] : prev.repos,
      }));

      try {
        const result = await searchRepos(query, filters, page);

        setState((prev) => ({
          ...prev,
          repos: page === 1 ? result.repos : [...prev.repos, ...result.repos],
          totalCount: result.total_count,
          hasMore: result.has_more,
          loading: false,
        }));
      } catch (err) {
        let errorMessage = t.discovery.error.generic;
        if (err instanceof ApiError && err.status === 429) {
          errorMessage = t.discovery.error.rateLimit;
        }
        setState((prev) => ({
          ...prev,
          loading: false,
          error: errorMessage,
        }));
      } finally {
        isFetchingRef.current = false;
      }
    },
    [t.discovery.error.generic, t.discovery.error.rateLimit]
  );

  const loadMore = useCallback(() => {
    if (state.hasMore && !state.loading && state.query) {
      void search(state.query, state.filters, state.page + 1);
    }
  }, [state.hasMore, state.loading, state.query, state.filters, state.page, search]);

  const setFilters = useCallback(
    (newFilters: SearchFilters) => {
      if (state.query) {
        void search(state.query, newFilters, 1);
      } else {
        setState((prev) => ({ ...prev, filters: newFilters }));
      }
    },
    [state.query, search]
  );

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return {
    ...state,
    search,
    loadMore,
    setFilters,
    reset,
  };
}
