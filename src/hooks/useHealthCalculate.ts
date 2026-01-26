/**
 * Hook for health score calculation operations.
 * Composes useScoreCalculator and useShowHealthDetails.
 */

import { RefObject } from "react";
import { HealthScoreSummary, HealthScoreResponse } from "../api/client";
import { useScoreCalculator } from "./useScoreCalculator";
import { useShowHealthDetails } from "./useShowHealthDetails";

interface UseHealthCalculateOptions {
  repoId: number;
  isMountedRef: RefObject<boolean>;
  setSummary: (summary: HealthScoreSummary | null) => void;
  setError: (error: string | null) => void;
  onShowDetails?: (details: HealthScoreResponse) => void;
}

interface UseHealthCalculateResult {
  calculating: boolean;
  handleCalculate: () => Promise<void>;
  handleShowDetails: () => Promise<void>;
}

export function useHealthCalculate({
  repoId,
  isMountedRef,
  setSummary,
  setError,
  onShowDetails,
}: UseHealthCalculateOptions): UseHealthCalculateResult {
  const { calculating, handleCalculate } = useScoreCalculator({
    repoId,
    isMountedRef,
    setSummary,
    setError,
    onShowDetails,
  });

  const { handleShowDetails } = useShowHealthDetails({
    repoId,
    isMountedRef,
    onShowDetails,
  });

  return { calculating, handleCalculate, handleShowDetails };
}
