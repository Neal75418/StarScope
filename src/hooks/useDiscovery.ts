/**
 * 探索頁面：GitHub Repository 搜尋與篩選。
 */

import { useCallback, useState } from "react";
import { SearchFilters } from "../api/client";
import { TrendingPeriod } from "../components/discovery";
import { useDiscoverySearch } from "./useDiscoverySearch";
import { GITHUB_SEARCH_PAGE_SIZE } from "../constants/api";

export type SortOption = "stars" | "forks" | "updated";

export interface DiscoveryState {
  // 篩選狀態
  keyword: string;
  period: TrendingPeriod | undefined;
  filters: SearchFilters;
  // UI 狀態
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

  // 觸發新搜尋（重設頁碼為 1）
  const search = useCallback(
    (kw: string, p: TrendingPeriod | undefined, f: SearchFilters) => {
      setState({ keyword: kw, period: p, filters: f, hasSearched: true });
      void executeSearch(kw, p, f, 1);
    },
    [executeSearch]
  );

  // 統一的參數更新函數
  const updateSearchParams = useCallback(
    (updates: {
      keyword?: string;
      period?: TrendingPeriod | undefined;
      filters?: SearchFilters;
    }) => {
      const newKeyword = updates.keyword ?? state.keyword;
      const newPeriod = updates.period !== undefined ? updates.period : state.period;
      const newFilters = updates.filters ?? state.filters;
      search(newKeyword, newPeriod, newFilters);
    },
    [state.keyword, state.period, state.filters, search]
  );

  // 設定值同時觸發搜尋
  const setKeyword = useCallback(
    (kw: string) => updateSearchParams({ keyword: kw }),
    [updateSearchParams]
  );

  const setPeriod = useCallback(
    (p: TrendingPeriod | undefined) => updateSearchParams({ period: p }),
    [updateSearchParams]
  );

  const setFilters = useCallback(
    (f: SearchFilters) => updateSearchParams({ filters: f }),
    [updateSearchParams]
  );

  const loadMore = useCallback(() => {
    if (hasMore && !loading) {
      const nextPage = Math.floor(repos.length / GITHUB_SEARCH_PAGE_SIZE) + 1;
      void executeSearch(state.keyword, state.period, state.filters, nextPage);
    }
  }, [hasMore, loading, repos.length, state.keyword, state.period, state.filters, executeSearch]);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
    resetSearch();
  }, [resetSearch]);

  // 移除特定篩選條件的便利方法
  const removeKeyword = useCallback(() => setKeyword(""), [setKeyword]);
  const removePeriod = useCallback(() => setPeriod(undefined), [setPeriod]);
  const removeLanguage = useCallback(() => {
    setFilters({ ...state.filters, language: undefined });
  }, [state.filters, setFilters]);

  // 套用已儲存的篩選條件
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
