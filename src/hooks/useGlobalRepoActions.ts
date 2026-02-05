import { useState, useCallback } from "react";
import { recalculateAllSimilarities } from "../api/client";
import { useI18n } from "../i18n";

interface Toast {
  success: (msg: string) => void;
  error: (msg: string) => void;
}

export function useGlobalRepoActions(toast: Toast) {
  const { t } = useI18n();
  const [isRecalculatingSimilarities, setIsRecalculatingSimilarities] = useState(false);

  // Recalculate all similarities
  const handleRecalculateAll = useCallback(async () => {
    setIsRecalculatingSimilarities(true);
    try {
      const result = await recalculateAllSimilarities();
      toast.success(
        t.watchlist.recalculateComplete
          ? t.watchlist.recalculateComplete
              .replace("{repos}", String(result.processed))
              .replace("{similarities}", String(result.similarities_found))
          : `Processed ${result.processed} repos, found ${result.similarities_found} similarities`
      );
    } catch (err) {
      console.error("Failed to recalculate similarities:", err);
      toast.error(t.toast.error);
    } finally {
      setIsRecalculatingSimilarities(false);
    }
  }, [toast, t]);

  return {
    isRecalculatingSimilarities,
    handleRecalculateAll,
  };
}
