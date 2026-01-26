/**
 * Hook for fetching similar repositories.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { SimilarRepo, getSimilarRepos, calculateRepoSimilarities } from "../api/client";
import { useI18n } from "../i18n";

interface UseSimilarReposResult {
  similar: SimilarRepo[];
  loading: boolean;
  error: string | null;
  recalculate: () => Promise<void>;
  isRecalculating: boolean;
}

export function useSimilarRepos(repoId: number, limit: number = 5): UseSimilarReposResult {
  const { t } = useI18n();
  const [similar, setSimilar] = useState<SimilarRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Prevent duplicate fetches from StrictMode
  const isFetchingRef = useRef(false);

  useEffect(() => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    let isMounted = true;
    setLoading(true);
    setError(null);

    getSimilarRepos(repoId, limit)
      .then((response) => {
        if (isMounted) {
          setSimilar(response.similar);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error("Failed to load similar repos:", err);
          setError(t.similarRepos.loadError);
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
        isFetchingRef.current = false;
      });

    return () => {
      isMounted = false;
    };
  }, [repoId, limit, t, refreshKey]);

  const recalculate = useCallback(async () => {
    setIsRecalculating(true);
    try {
      await calculateRepoSimilarities(repoId);
      // Trigger reload after calculation
      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      console.error("Failed to recalculate similarities:", err);
    } finally {
      setIsRecalculating(false);
    }
  }, [repoId]);

  return { similar, loading, error, recalculate, isRecalculating };
}
