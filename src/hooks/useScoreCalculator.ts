/**
 * Hook for calculating health score.
 */

import { useState, useCallback, RefObject } from "react";
import { calculateHealthScore, HealthScoreSummary, HealthScoreResponse } from "../api/client";
import { useI18n } from "../i18n";

interface UseScoreCalculatorOptions {
  repoId: number;
  isMountedRef: RefObject<boolean>;
  setSummary: (summary: HealthScoreSummary | null) => void;
  setError: (error: string | null) => void;
  onShowDetails?: (details: HealthScoreResponse) => void;
}

function toSummary(result: HealthScoreResponse): HealthScoreSummary {
  return {
    repo_id: result.repo_id,
    overall_score: result.overall_score,
    grade: result.grade,
    calculated_at: result.calculated_at,
  };
}

export function useScoreCalculator({
  repoId,
  isMountedRef,
  setSummary,
  setError,
  onShowDetails,
}: UseScoreCalculatorOptions) {
  const { t } = useI18n();
  const [calculating, setCalculating] = useState(false);

  const handleCalculate = useCallback(async () => {
    setCalculating(true);
    setError(null);

    try {
      const result = await calculateHealthScore(repoId);
      if (!isMountedRef.current) return;
      setSummary(toSummary(result));
      onShowDetails?.(result);
    } catch (err) {
      if (isMountedRef.current) {
        setError(t.healthScore.calculationFailed);
        console.error("Health score calculation error:", err);
      }
    } finally {
      if (isMountedRef.current) setCalculating(false);
    }
  }, [repoId, isMountedRef, setSummary, setError, onShowDetails, t]);

  return { calculating, handleCalculate };
}
