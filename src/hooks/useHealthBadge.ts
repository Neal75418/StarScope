/**
 * Hook for health badge state and operations.
 * Composes useHealthSummary and useHealthCalculate for reduced complexity.
 */

import { useCallback } from "react";
import { HealthScoreSummary, HealthScoreResponse } from "../api/client";
import { useHealthSummary } from "./useHealthSummary";
import { useHealthCalculate } from "./useHealthCalculate";

interface UseHealthBadgeOptions {
  repoId: number;
  onShowDetails?: (details: HealthScoreResponse) => void;
}

interface UseHealthBadgeResult {
  summary: HealthScoreSummary | null;
  loading: boolean;
  calculating: boolean;
  error: string | null;
  handleCalculate: () => Promise<void>;
  handleClick: () => Promise<void>;
}

export function useHealthBadge({
  repoId,
  onShowDetails,
}: UseHealthBadgeOptions): UseHealthBadgeResult {
  const { summary, setSummary, loading, error, setError, isMountedRef } = useHealthSummary(repoId);

  const { calculating, handleCalculate, handleShowDetails } = useHealthCalculate({
    repoId,
    isMountedRef,
    setSummary,
    setError,
    onShowDetails,
  });

  const handleClick = useCallback(async () => {
    if (!summary) {
      await handleCalculate();
    } else {
      await handleShowDetails();
    }
  }, [summary, handleCalculate, handleShowDetails]);

  return {
    summary,
    loading,
    calculating,
    error,
    handleCalculate,
    handleClick,
  };
}
