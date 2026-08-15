/**
 * 熱門主題建議：讀快取 + 手動重算。
 *
 * 刻意不自動更新：主題趨勢以週為單位變動，每日重算多半在重算同一份答案，
 * 卻要吃掉與 feed 產生、探索搜尋共用的每分鐘 30 次搜尋配額。改由使用者
 * 看著「上次更新時間」自行決定何時按。
 */
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTrendingTopics, refreshTrendingTopics } from "../api/client";
import { queryKeys } from "../lib/react-query";

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

  const refresh = useCallback(() => refreshMutation.mutateAsync(), [refreshMutation]);

  return {
    topics: query.data?.topics ?? [],
    computedAt: query.data?.computed_at ?? null,
    isLoading: query.isLoading,
    isRefreshing: refreshMutation.isPending,
    refreshError: refreshMutation.error,
    refresh,
  };
}
