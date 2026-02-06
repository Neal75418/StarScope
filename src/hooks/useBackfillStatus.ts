/**
 * Star 歷史回填狀態查詢與離線處理。
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { BackfillStatus, getBackfillStatus, ApiError } from "../api/client";
import { useI18n } from "../i18n";
import { isNetworkError } from "../utils/backfillHelpers";

export function useBackfillStatus(repoId: number, exceedsStarLimit: boolean) {
  const { t } = useI18n();
  const [status, setStatus] = useState<BackfillStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // 離線時保留最後成功的狀態
  const lastStatusRef = useRef<BackfillStatus | null>(null);

  const loadStatus = useCallback(async () => {
    if (exceedsStarLimit) return;

    try {
      setLoading(true);
      setError(null);
      setIsOffline(false);
      const result = await getBackfillStatus(repoId);
      setStatus(result);
      lastStatusRef.current = result;
      setLastUpdated(new Date());
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setStatus(null);
        lastStatusRef.current = null;
      } else if (isNetworkError(err)) {
        // 網路錯誤 — 顯示離線狀態但保留上次資料
        console.warn("回填狀態載入時網路錯誤:", err);
        setIsOffline(true);
        if (lastStatusRef.current) {
          setStatus(lastStatusRef.current);
        }
        setError(t.starHistory.offline ?? "離線中 — 顯示快取資料");
      } else {
        console.error("回填狀態載入失敗:", err);
        setError(t.starHistory.backfillFailed);
      }
    } finally {
      setLoading(false);
    }
  }, [repoId, t, exceedsStarLimit]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  return {
    status,
    loading,
    error,
    isOffline,
    lastUpdated,
    loadStatus,
    setError, // 開放給其他 hook / 元件設定錯誤
  };
}
