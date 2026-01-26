import { useState, useCallback } from "react";
import { autoTagAllRepos, recalculateAllSimilarities } from "../api/client";
import { useI18n } from "../i18n";

interface Toast {
  success: (msg: string) => void;
  error: (msg: string) => void;
}

export function useGlobalRepoActions(toast: Toast) {
  const { t } = useI18n();
  const [isAutoTagging, setIsAutoTagging] = useState(false);
  const [isRecalculatingSimilarities, setIsRecalculatingSimilarities] = useState(false);

  // Auto-tag all repos
  const handleAutoTagAll = useCallback(async () => {
    setIsAutoTagging(true);
    try {
      const result = await autoTagAllRepos();
      toast.success(
        t.watchlist.autoTagComplete
          ? t.watchlist.autoTagComplete
              .replace("{repos}", String(result.repos_tagged))
              .replace("{tags}", String(result.tags_applied))
          : `Tagged ${result.repos_tagged} repos with ${result.tags_applied} tags`
      );
    } catch (err) {
      console.error("Failed to auto-tag repos:", err);
      toast.error(t.toast.error);
    } finally {
      setIsAutoTagging(false);
    }
  }, [toast, t]);

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
    isAutoTagging,
    isRecalculatingSimilarities,
    handleAutoTagAll,
    handleRecalculateAll,
  };
}
