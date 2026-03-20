/**
 * 探索頁面：GitHub Repository 搜尋與篩選。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SearchFilters } from "../api/client";
import { TrendingPeriod } from "../components/discovery";
import { useDiscoverySearch } from "./useDiscoverySearch";

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

/** 搜尋輸入的 debounce 延遲（毫秒），避免每次按鍵都觸發 API 請求。 */
const SEARCH_DEBOUNCE_MS = 300;

export function useDiscovery() {
  const {
    repos,
    totalCount,
    hasMore,
    loading,
    error,
    executeSearch,
    resetSearch,
    loadMore: fetchMore,
  } = useDiscoverySearch();
  const [state, setState] = useState<DiscoveryState>(INITIAL_STATE);

  // 透過 ref 追蹤最新 state，避免 useCallback 的 stale closure 問題
  const stateRef = useRef(state);
  stateRef.current = state;

  // Debounce timer ref — 延遲新搜尋的 API 呼叫，避免每次按鍵都發請求
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 清除 debounce timer（unmount 時）
  useEffect(() => {
    return () => clearTimeout(searchTimerRef.current);
  }, []);

  // 觸發新搜尋（重設頁碼為 1），以 debounce 延遲 API 呼叫
  const search = useCallback(
    (kw: string, p: TrendingPeriod | undefined, f: SearchFilters) => {
      setState({ keyword: kw, period: p, filters: f, hasSearched: true });
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => {
        void executeSearch(kw, p, f, 1);
      }, SEARCH_DEBOUNCE_MS);
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

  const reset = useCallback(() => {
    clearTimeout(searchTimerRef.current);
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

  const removeMaxStars = useCallback(() => {
    setFilters({ ...stateRef.current.filters, maxStars: undefined });
  }, [setFilters]);

  const removeLicense = useCallback(() => {
    setFilters({ ...stateRef.current.filters, license: undefined });
  }, [setFilters]);

  const removeHideArchived = useCallback(() => {
    setFilters({ ...stateRef.current.filters, hideArchived: undefined });
  }, [setFilters]);

  // 從 URL 恢復狀態（跳過 debounce 直接觸發搜尋）
  const restoreState = useCallback(
    (restored: { keyword: string; period: TrendingPeriod | undefined; filters: SearchFilters }) => {
      setState({ ...restored, hasSearched: true });
      clearTimeout(searchTimerRef.current);
      void executeSearch(restored.keyword, restored.period, restored.filters, 1);
    },
    [executeSearch]
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
    removeTopic,
    removeMinStars,
    removeMaxStars,
    removeLicense,
    removeHideArchived,
    reset,
    loadMore: fetchMore,
    applySavedFilter: search,
    restoreState,
  };
}
