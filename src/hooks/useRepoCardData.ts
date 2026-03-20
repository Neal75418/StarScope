/**
 * Repo 卡片資料取得（badges 與 signals），支援批次預載與個別取得。
 * 使用 React Query 管理快取與請求去重。
 */

import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ContextBadge,
  EarlySignal,
  getContextBadges,
  getRepoSignals,
  fetchRepoContext,
} from "../api/client";
import { logger } from "../utils/logger";
import { queryKeys } from "../lib/react-query";

interface UseRepoCardDataResult {
  badges: ContextBadge[];
  badgesLoading: boolean;
  signals: EarlySignal[];
  signalsLoading: boolean;
  activeSignalCount: number;
  refreshContext: () => Promise<void>;
  isRefreshingContext: boolean;
}

interface PreloadedData {
  badges?: ContextBadge[];
  signals?: EarlySignal[];
}

export function useRepoCardData(repoId: number, preloaded?: PreloadedData): UseRepoCardDataResult {
  const queryClient = useQueryClient();
  const [isRefreshingContext, setIsRefreshingContext] = useState(false);

  // 若有預載資料，用 initialData 讓 React Query 立即顯示，但仍可被 refetch 覆蓋
  const badgesQuery = useQuery<ContextBadge[], Error>({
    queryKey: queryKeys.repoCard.badges(repoId),
    queryFn: async () => {
      const response = await getContextBadges(repoId);
      return response.badges;
    },
    initialData: preloaded?.badges,
    enabled: preloaded?.badges === undefined || isRefreshingContext === false,
  });

  const signalsQuery = useQuery<EarlySignal[], Error>({
    queryKey: queryKeys.repoCard.signals(repoId),
    queryFn: async () => {
      const response = await getRepoSignals(repoId);
      return response.signals;
    },
    initialData: preloaded?.signals,
    enabled: preloaded?.signals === undefined || isRefreshingContext,
  });

  const badges = badgesQuery.data ?? [];
  const signals = signalsQuery.data ?? [];

  // 計算未確認的活躍 signals 數量
  const activeSignalCount = signals.filter((s) => !s.acknowledged).length;

  const refreshContext = useCallback(async () => {
    setIsRefreshingContext(true);
    try {
      await fetchRepoContext(repoId);
      // context 取得後觸發 badges + signals 重新載入
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.repoCard.badges(repoId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.repoCard.signals(repoId) }),
      ]);
    } catch (err) {
      logger.error("[RepoCardData] Context 重新整理失敗:", err);
    } finally {
      setIsRefreshingContext(false);
    }
  }, [repoId, queryClient]);

  return {
    badges,
    badgesLoading: preloaded?.badges !== undefined ? false : badgesQuery.isLoading,
    signals,
    signalsLoading: preloaded?.signals !== undefined ? false : signalsQuery.isLoading,
    activeSignalCount,
    refreshContext,
    isRefreshingContext,
  };
}
