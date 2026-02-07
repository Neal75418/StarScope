/**
 * 相似 Repository 的取得與重新計算。
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { SimilarRepo, getSimilarRepos, calculateRepoSimilarities } from "../api/client";
import { useI18n } from "../i18n";
import { logger } from "../utils/logger";

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

  // 避免 StrictMode 重複請求
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
          logger.error("相似 Repo 載入失敗:", err);
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
      // 計算完成後觸發重新載入
      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      logger.error("重新計算相似度失敗:", err);
    } finally {
      setIsRecalculating(false);
    }
  }, [repoId]);

  return { similar, loading, error, recalculate, isRecalculating };
}
