/**
 * 探索頁面：GitHub Repository 搜尋與篩選。
 */

import { useCallback, useRef, useState } from "react";
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

  // 透過 ref 追蹤最新 state，避免 useCallback 的 stale closure 問題
  const stateRef = useRef(state);
  stateRef.current = state;

  // 觸發新搜尋（重設頁碼為 1）
  const search = useCallback(
    (kw: string, p: TrendingPeriod | undefined, f: SearchFilters) => {
      setState({ keyword: kw, period: p, filters: f, hasSearched: true });
      void executeSearch(kw, p, f, 1);
    },
    [executeSearch]
  );

  // 統一的參數更新函數（透過 stateRef 讀取最新值，避免 stale closure）
  const updateSearchParams = useCallback(
    (updates: {
      keyword?: string;
      period?: TrendingPeriod | undefined;
      filters?: SearchFilters;
    }) => {
      const cur = stateRef.current;
      const newKeyword = updates.keyword ?? cur.keyword;
      const newPeriod = updates.period !== undefined ? updates.period : cur.period;
      const newFilters = updates.filters ?? cur.filters;
      search(newKeyword, newPeriod, newFilters);
    },
    [search]
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
      const { keyword, period, filters } = stateRef.current;
      const nextPage = Math.floor(repos.length / GITHUB_SEARCH_PAGE_SIZE) + 1;
      void executeSearch(keyword, period, filters, nextPage);
    }
  }, [hasMore, loading, repos.length, executeSearch]);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
    resetSearch();
  }, [resetSearch]);

  // 移除特定篩選條件的便利方法
  const removeKeyword = useCallback(() => setKeyword(""), [setKeyword]);
  const removePeriod = useCallback(() => setPeriod(undefined), [setPeriod]);
  const removeLanguage = useCallback(() => {
    setFilters({ ...stateRef.current.filters, language: undefined });
  }, [setFilters]);

  const removeTopic = useCallback(() => {
    setFilters({ ...stateRef.current.filters, topic: undefined });
  }, [setFilters]);

  const removeMinStars = useCallback(() => {
    setFilters({ ...stateRef.current.filters, minStars: undefined });
  }, [setFilters]);

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
    removeTopic,
    removeMinStars,
    reset,
    loadMore,
    applySavedFilter: search,
  };
}
