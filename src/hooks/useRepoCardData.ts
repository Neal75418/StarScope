/**
 * Repo 卡片資料取得（badges 與 signals），支援批次預載與個別取得。
 */

import { useState, useCallback } from "react";
import {
  ContextBadge,
  EarlySignal,
  getContextBadges,
  getRepoSignals,
  fetchRepoContext,
} from "../api/client";
import { useAsyncFetch } from "./useAsyncFetch";
import { logger } from "../utils/logger";

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
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshingContext, setIsRefreshingContext] = useState(false);

  // 若有預載資料且尚未手動刷新，跳過個別 API 呼叫
  // deps=[] 表示永不 fetch；手動 refresh 後 refreshKey>0，切到正常 deps 觸發 fetch
  const skipBadgesFetch = preloaded?.badges !== undefined && refreshKey === 0;
  const skipSignalsFetch = preloaded?.signals !== undefined;

  const badgesDeps = skipBadgesFetch ? [] : [repoId, refreshKey];
  const { data: fetchedBadges, loading: badgesLoading } = useAsyncFetch(
    () => getContextBadges(repoId),
    (response) => response.badges,
    [] as ContextBadge[],
    badgesDeps,
    "badges",
    { cacheKey: skipBadgesFetch ? undefined : `badges:${repoId}:${refreshKey}` }
  );

  const signalsDeps = skipSignalsFetch ? [] : [repoId];
  const { data: fetchedSignals, loading: signalsLoading } = useAsyncFetch(
    () => getRepoSignals(repoId),
    (response) => response.signals,
    [] as EarlySignal[],
    signalsDeps,
    "signals",
    { cacheKey: skipSignalsFetch ? undefined : `signals:${repoId}` }
  );

  // 優先使用預載資料，手動刷新後改用 fetch 結果
  const badges = skipBadgesFetch ? (preloaded.badges ?? []) : fetchedBadges;
  const signals = skipSignalsFetch ? (preloaded.signals ?? []) : fetchedSignals;

  // 計算未確認的活躍 signals 數量
  const activeSignalCount = signals.filter((s) => !s.acknowledged).length;

  const refreshContext = useCallback(async () => {
    setIsRefreshingContext(true);
    try {
      await fetchRepoContext(repoId);
      // context 取得後觸發 badges 重新載入（強制個別 fetch）
      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      logger.error("[RepoCardData] Context 重新整理失敗:", err);
    } finally {
      setIsRefreshingContext(false);
    }
  }, [repoId]);

  return {
    badges,
    badgesLoading: skipBadgesFetch ? false : badgesLoading,
    signals,
    signalsLoading: skipSignalsFetch ? false : signalsLoading,
    activeSignalCount,
    refreshContext,
    isRefreshingContext,
  };
}
