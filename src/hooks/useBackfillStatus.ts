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

  // Keep last successful status when offline
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
        // Network error - show offline state but keep last data
        console.warn("Network error loading backfill status:", err);
        setIsOffline(true);
        if (lastStatusRef.current) {
          setStatus(lastStatusRef.current);
        }
        setError(t.starHistory.offline ?? "Offline - showing cached data");
      } else {
        console.error("Failed to load backfill status:", err);
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
    setError, // Exposed for other hooks/components to set error
  };
}
