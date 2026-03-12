/**
 * Star 歷史回填狀態查詢與離線處理。
 * 使用 React Query 管理快取與自動重試。
 *
 * queryFn 保持純函式，透過 ref 標記 fetch 結果類型，
 * 再由 useEffect 同步至 React state（避免 closure 捕獲過期 setState）。
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BackfillStatus, getBackfillStatus, ApiError } from "../api/client";
import { useI18n } from "../i18n";
import { isNetworkError } from "../utils/backfillHelpers";
import { logger } from "../utils/logger";
import { queryKeys } from "../lib/react-query";

type FetchOutcome = "success" | "network-fallback" | null;

export function useBackfillStatus(repoId: number, exceedsStarLimit: boolean) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [isOffline, setIsOffline] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // 離線時保留最後成功的狀態
  const lastStatusRef = useRef<BackfillStatus | null>(null);
  // 標記最近一次 fetch 結果類型（由 queryFn 設定，由 useEffect 讀取）
  const fetchOutcomeRef = useRef<FetchOutcome>(null);

  const query = useQuery<BackfillStatus | null, Error>({
    queryKey: queryKeys.backfill.status(repoId),
    queryFn: async () => {
      try {
        const result = await getBackfillStatus(repoId);
        lastStatusRef.current = result;
        fetchOutcomeRef.current = "success";
        return result;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          lastStatusRef.current = null;
          fetchOutcomeRef.current = "success";
          return null;
        }
        if (isNetworkError(err)) {
          logger.warn("[BackfillStatus] 回填狀態載入時網路錯誤:", err);
          fetchOutcomeRef.current = "network-fallback";
          // 回傳上次快取的資料而非拋出錯誤
          return lastStatusRef.current;
        }
        logger.error("[BackfillStatus] 回填狀態載入失敗:", err);
        throw err;
      }
    },
    enabled: !exceedsStarLimit,
    // 404 和網路錯誤已在 queryFn 處理，不需要額外重試
    retry: false,
  });

  // 當 fetch 完成時，根據 outcome 同步離線 / 錯誤 / 時間戳狀態
  useEffect(() => {
    if (query.isFetching || fetchOutcomeRef.current == null) return;
    const outcome = fetchOutcomeRef.current;
    fetchOutcomeRef.current = null;

    if (outcome === "network-fallback") {
      setIsOffline(true);
      setManualError(t.starHistory.offline ?? "離線中 — 顯示快取資料");
    } else {
      setIsOffline(false);
      setManualError(null);
      setLastUpdated(new Date());
    }
  }, [query.isFetching, t.starHistory.offline]);

  const loadStatus = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: queryKeys.backfill.status(repoId) });
  }, [queryClient, repoId]);

  // 錯誤優先使用手動設定的，否則使用 React Query 的
  const error = manualError ?? (query.error ? t.starHistory.backfillFailed : null);

  return {
    status: query.data ?? null,
    loading: query.isLoading,
    error,
    isOffline,
    lastUpdated,
    loadStatus,
    setError: setManualError,
  };
}
