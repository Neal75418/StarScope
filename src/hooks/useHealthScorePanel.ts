/**
 * Hook for health score panel logic.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { HealthScoreResponse, calculateHealthScore } from "../api/client";
import { useI18n } from "../i18n";

interface UseHealthScorePanelOptions {
  repoId: number;
  onClose: () => void;
  onRecalculate?: (newDetails: HealthScoreResponse) => void;
}

interface UseHealthScorePanelResult {
  recalculating: boolean;
  error: string | null;
  handleRecalculate: () => Promise<void>;
}

export function useHealthScorePanel({
  repoId,
  onClose,
  onRecalculate,
}: UseHealthScorePanelOptions): UseHealthScorePanelResult {
  const { t } = useI18n();
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleRecalculate = useCallback(async () => {
    setRecalculating(true);
    setError(null);
    try {
      const newDetails = await calculateHealthScore(repoId);
      if (!isMountedRef.current) return;
      if (onRecalculate) {
        onRecalculate(newDetails);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(t.healthScore.recalculateFailed);
      console.error("Failed to recalculate health score:", err);
    } finally {
      if (isMountedRef.current) {
        setRecalculating(false);
      }
    }
  }, [repoId, onRecalculate, t]);

  return { recalculating, error, handleRecalculate };
}
