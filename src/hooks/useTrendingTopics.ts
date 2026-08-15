/**
 * 熱門主題建議：讀快取 + 手動重算 + 重算期間的進度。
 *
 * 刻意不自動更新：主題趨勢以週為單位變動，每日重算多半在重算同一份答案，
 * 卻要吃掉與 feed 產生、探索搜尋共用的每分鐘 30 次搜尋配額。改由使用者
 * 看著「上次更新時間」自行決定何時按。
 *
 * 重算是一個長達一兩分鐘的單一請求，回應之前拿不到任何中間狀態，
 * 所以進度另外走一條輪詢——沒有它，等待期間對使用者就是黑箱，
 * 分不出「還在跑」與「卡住了」。
 */
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTrendingProgress, getTrendingTopics, refreshTrendingTopics } from "../api/client";
import { queryKeys } from "../lib/react-query";

const PROGRESS_POLL_MS = 1500;

export function useTrendingTopics() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.interests.trending(),
    queryFn: ({ signal }) => getTrendingTopics(signal),
  });

  const refreshMutation = useMutation({
    mutationFn: () => refreshTrendingTopics(),
    onSuccess: (data) => {
      // 直接寫入結果，省一次往返
      queryClient.setQueryData(queryKeys.interests.trending(), data);
    },
  });

  const isRefreshing = refreshMutation.isPending;

  // 只在重算進行中輪詢；gcTime 0 讓結束後不留殘值，避免下次開始時閃到舊進度
  const progressQuery = useQuery({
    queryKey: [...queryKeys.interests.trending(), "progress"],
    queryFn: ({ signal }) => getTrendingProgress(signal),
    enabled: isRefreshing,
    refetchInterval: isRefreshing ? PROGRESS_POLL_MS : false,
    gcTime: 0,
  });

  const refresh = useCallback(() => refreshMutation.mutateAsync(), [refreshMutation]);

  return {
    topics: query.data?.topics ?? [],
    computedAt: query.data?.computed_at ?? null,
    isLoading: query.isLoading,
    isRefreshing,
    /** 重算進行中的進度；沒在跑時為 null */
    progress: isRefreshing && progressQuery.data?.running ? progressQuery.data : null,
    refreshError: refreshMutation.error,
    refresh,
  };
}
