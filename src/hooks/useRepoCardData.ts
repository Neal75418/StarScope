/**
 * Repo 卡片資料取得（badges 與 signals），支援批次預載與個別取得。
 * 使用 React Query 管理快取與請求去重。
 */

import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContextBadge, EarlySignal } from "../api/client";
import { getContextBadges, getRepoSignals, fetchRepoContext } from "../api/client";
import { logger } from "../utils/logger";
import { queryKeys } from "../lib/react-query";
import { getErrorMessage } from "../utils/error";
import { useWatchlistActions } from "../contexts/WatchlistContext";
import { useI18n } from "../i18n";

interface UseRepoCardDataResult {
  badges: ContextBadge[];
  badgesLoading: boolean;
  /** 原始 signals 陣列，供需要直接存取的消費端使用（RepoCard 僅用 activeSignalCount）。 */
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

/**
 * @param deferToBatch 由「擁有批次載入的父層」設為 true。設定後，卡片在批次負責
 *   期間不自行發請求——批次有 150ms debounce，個別請求會搶先跑掉，實測 200 個
 *   repo 的 Grid 檢視因此發出 348 個請求（正確值是 8 個）。後端的批次端點對沒有
 *   資料的 repo 也會回空陣列，所以批次一到貨 preloaded 必為 defined，個別請求
 *   從來不是必要的；批次失敗時父層會把此旗標設回 false 當退路。
 */
export function useRepoCardData(
  repoId: number,
  preloaded?: PreloadedData,
  deferToBatch = false
): UseRepoCardDataResult {
  const queryClient = useQueryClient();
  const { showToast } = useWatchlistActions();
  const { t } = useI18n();
  const [isRefreshingContext, setIsRefreshingContext] = useState(false);

  // 若有預載資料，用 initialData 讓 React Query 立即顯示，但仍可被 refetch 覆蓋
  const badgesQuery = useQuery<ContextBadge[], Error>({
    queryKey: queryKeys.repoCard.badges(repoId),
    queryFn: async () => {
      const response = await getContextBadges(repoId);
      return response.badges;
    },
    initialData: preloaded?.badges,
    enabled: (!deferToBatch && preloaded?.badges === undefined) || isRefreshingContext,
  });

  const signalsQuery = useQuery<EarlySignal[], Error>({
    queryKey: queryKeys.repoCard.signals(repoId),
    queryFn: async () => {
      const response = await getRepoSignals(repoId);
      return response.signals;
    },
    initialData: preloaded?.signals,
    enabled: (!deferToBatch && preloaded?.signals === undefined) || isRefreshingContext,
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
      // 只寫 log 等於對使用者無聲：轉圈停了、徽章沒變、什麼都沒說
      showToast("error", getErrorMessage(err, t.common.error));
    } finally {
      setIsRefreshingContext(false);
    }
  }, [repoId, queryClient, showToast, t]);

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
