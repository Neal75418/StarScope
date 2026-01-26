/**
 * Hook for showing health score details.
 */

import { useCallback, RefObject } from "react";
import { getHealthScore, HealthScoreResponse } from "../api/client";

interface UseShowHealthDetailsOptions {
  repoId: number;
  isMountedRef: RefObject<boolean>;
  onShowDetails?: (details: HealthScoreResponse) => void;
}

export function useShowHealthDetails({
  repoId,
  isMountedRef,
  onShowDetails,
}: UseShowHealthDetailsOptions) {
  const handleShowDetails = useCallback(async () => {
    if (!onShowDetails) return;
    try {
      const fullDetails = await getHealthScore(repoId);
      if (isMountedRef.current) onShowDetails(fullDetails);
    } catch (err) {
      console.error("Failed to get health details:", err);
    }
  }, [repoId, isMountedRef, onShowDetails]);

  return { handleShowDetails };
}
