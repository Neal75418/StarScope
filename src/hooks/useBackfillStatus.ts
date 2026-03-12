/**
 * Star 歷史回填狀態查詢與離線處理。
 * 使用 React Query 管理快取與自動重試。
 */

import { useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { BackfillStatus, getBackfillStatus, ApiError } from "../api/client";
import { useI18n } from "../i18n";
import { isNetworkError } from "../utils/backfillHelpers";
import { logger } from "../utils/logger";
import { queryKeys } from "../lib/react-query";

export function useBackfillStatus(repoId: number, exceedsStarLimit: boolean) {
  const { t } = useI18n();
  const [isOffline, setIsOffline] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // 離線時保留最後成功的狀態
  const lastStatusRef = useRef<BackfillStatus | null>(null);

  const query = useQuery<BackfillStatus | null, Error>({
    queryKey: queryKeys.backfill.status(repoId),
    queryFn: async () => {
      try {
        setIsOffline(false);
        const result = await getBackfillStatus(repoId);
        lastStatusRef.current = result;
        setLastUpdated(new Date());
        setManualError(null);
        return result;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          lastStatusRef.current = null;
          return null;
        }
        if (isNetworkError(err)) {
          logger.warn("[BackfillStatus] 回填狀態載入時網路錯誤:", err);
          setIsOffline(true);
          setManualError(t.starHistory.offline ?? "離線中 — 顯示快取資料");
          // 回傳上次快取的資料而非拋出錯誤
          return lastStatusRef.current;
        }
        logger.error("[BackfillStatus] 回填狀態載入失敗:", err);
        throw err;
      }
    },
    enabled: !exceedsStarLimit,
    staleTime: 1000 * 60 * 5,
    // 404 和網路錯誤已在 queryFn 處理，不需要額外重試
    retry: false,
  });

  const loadStatus = useCallback(async () => {
    await query.refetch();
  }, [query]);

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
