/**
 * 探索頁面的搜尋邏輯，使用 React Query useInfiniteQuery 實現快取與分頁。
 */

import { useState, useCallback, useMemo } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { SearchFilters, DiscoveryRepo } from "../api/client";
import { buildCombinedQuery, fetchSearchResults, SearchResult } from "../utils/searchHelpers";
import { TrendingPeriod } from "../components/discovery";
import { useI18n } from "../i18n";
import { queryKeys } from "../lib/react-query";

export interface DiscoverySearchState {
  repos: DiscoveryRepo[];
  totalCount: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
}

interface SearchParams {
  query: string;
  filters: SearchFilters;
}

export function useDiscoverySearch() {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // 驅動 query key 的搜尋參數；null = 尚未搜尋
  const [searchParams, setSearchParams] = useState<SearchParams | null>(null);

  const queryKey = useMemo(
    () =>
      queryKeys.discovery.search({
        query: searchParams?.query ?? "",
        filters: (searchParams?.filters ?? {}) as Record<string, unknown>,
      }),
    [searchParams]
  );

  const { data, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteQuery<
    SearchResult,
    Error
  >({
    queryKey,
    queryFn: async ({ pageParam, signal }): Promise<SearchResult> => {
      if (!searchParams) throw new Error("Search params not available");
      return fetchSearchResults(
        searchParams.query,
        searchParams.filters,
        pageParam as number,
        t,
        signal
      );
    },
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    initialPageParam: 1,
    enabled: !!searchParams?.query.trim(),
    staleTime: 2 * 60 * 1000, // 2 分鐘內視為新鮮
  });

  // 將 infinite pages 展平為單一陣列
  const repos = useMemo<DiscoveryRepo[]>(
    () => (searchParams ? (data?.pages.flatMap((p) => p.repos) ?? []) : []),
    [data?.pages, searchParams]
  );

  const lastPage = searchParams ? data?.pages[data.pages.length - 1] : undefined;
  const totalCount = lastPage?.totalCount ?? 0;
  const error = lastPage?.error ?? null;

  /**
   * 觸發新搜尋（page 參數保留向後相容；page > 1 由 loadMore 處理）。
   */
  const executeSearch = useCallback(
    (
      keyword: string,
      period: TrendingPeriod | undefined,
      filters: SearchFilters,
      _page: number = 1
    ) => {
      const query = buildCombinedQuery(keyword, period, filters.language);

      if (!query.trim()) {
        setSearchParams(null);
        return;
      }

      setSearchParams({ query, filters });
    },
    []
  );

  /** 載入下一頁結果。 */
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  /** 重設搜尋狀態與快取。 */
  const resetSearch = useCallback(() => {
    setSearchParams(null);
    queryClient.removeQueries({ queryKey: [...queryKeys.discovery.all, "search"] });
  }, [queryClient]);

  return {
    repos,
    totalCount,
    hasMore: hasNextPage ?? false,
    loading: isFetching,
    error,
    executeSearch,
    resetSearch,
    loadMore,
  };
}
