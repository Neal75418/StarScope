/**
 * Hook for fetching health score summary.
 */

import { useState, useEffect, useRef, RefObject } from "react";
import { getHealthScoreSummary, HealthScoreSummary } from "../api/client";
import { useI18n } from "../i18n";

interface UseHealthSummaryResult {
  summary: HealthScoreSummary | null;
  setSummary: (summary: HealthScoreSummary | null) => void;
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  isMountedRef: RefObject<boolean>;
}

export function useHealthSummary(repoId: number): UseHealthSummaryResult {
  const { t } = useI18n();
  const [summary, setSummary] = useState<HealthScoreSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    setLoading(true);
    setError(null);

    getHealthScoreSummary(repoId)
      .then((data) => {
        if (isMountedRef.current) setSummary(data);
      })
      .catch((err) => {
        if (!isMountedRef.current) return;
        // 404 means no score calculated yet - not an error
        if (err.status === 404) {
          setSummary(null);
        } else {
          setError(t.healthScore.failedToLoad);
          console.error("Health score error:", err);
        }
      })
      .finally(() => {
        if (isMountedRef.current) setLoading(false);
      });

    return () => {
      isMountedRef.current = false;
    };
  }, [repoId, t]);

  return { summary, setSummary, loading, error, setError, isMountedRef };
}
