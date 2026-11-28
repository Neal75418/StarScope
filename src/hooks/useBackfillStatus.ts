/**
 * Star 歷史回填狀態查詢與離線處理。
 * 使用 React Query 管理快取（重試交給 apiCall，見下方 retry: false）。
 *
 * queryFn 保持純函式，透過 ref 標記 fetch 結果類型，
 * 再由 useEffect 同步至 React state（避免 closure 捕獲過期 setState）。
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BackfillStatus } from "../api/client";
import { getBackfillStatus, ApiError } from "../api/client";
import { useI18n } from "../i18n";
import { isEngineUnreachable } from "../utils/writeFailure";
import { logger } from "../utils/logger";
import { loadStatus as toLoadStatus, queryKeys } from "../lib/react-query";

/** error：讀不到（伺服器錯誤、逾時等）——不是離線，要清掉前一次離線留下的狀態 */
type FetchOutcome = "success" | "network-fallback" | "error" | null;

export function useBackfillStatus(repoId: number, exceedsStarLimit: boolean) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [isOffline, setIsOffline] = useState(false);
  const [offlineMessage, setOfflineMessage] = useState<string | null>(null);
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
        // 只有連不上引擎才當成離線（保留上次的狀態、停用回填）；伺服器錯誤與逾時是讀不到，不是離線
        if (isEngineUnreachable(err)) {
          logger.warn("[BackfillStatus] 回填狀態載入時網路錯誤:", err);
          fetchOutcomeRef.current = "network-fallback";
          // 回傳上次快取的資料而非拋出錯誤
          return lastStatusRef.current;
        }
        logger.error("[BackfillStatus] 回填狀態載入失敗:", err);
        fetchOutcomeRef.current = "error";
        throw err;
      }
    },
    enabled: !exceedsStarLimit,
    // apiCall 對 GET 已經重試過兩次（逾時的話前後約 90 秒）；404 與連不上引擎在 queryFn 處理
    retry: false,
  });

  // 當 fetch 完成時，根據 outcome 同步離線 / 錯誤 / 時間戳狀態
  useEffect(() => {
    if (query.isFetching || fetchOutcomeRef.current == null) return;
    const outcome = fetchOutcomeRef.current;
    fetchOutcomeRef.current = null;

    if (outcome === "network-fallback") {
      setIsOffline(true);
      setOfflineMessage(t.starHistory.offline);
    } else if (outcome === "error") {
      // 讀不到由 statusLoad 交給 LoadError 說（附重試）；前一次離線留下的說明與停用都要清掉
      setIsOffline(false);
      setOfflineMessage(null);
    } else {
      setIsOffline(false);
      setOfflineMessage(null);
      setLastUpdated(new Date());
    }
  }, [query.isFetching, t.starHistory.offline]);

  const loadStatus = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: queryKeys.backfill.status(repoId) });
  }, [queryClient, repoId]);

  // error 只有離線說明：讀不到狀態由呼叫端依 statusLoad 顯示 LoadError（附重試），回填動作的說明在 useBackfillAction
  const error = offlineMessage;
  const statusLoad = toLoadStatus(query);

  return {
    status: query.data ?? null,
    loading: query.isLoading,
    error,
    isOffline,
    lastUpdated,
    loadStatus,
    statusLoad,
  };
}
