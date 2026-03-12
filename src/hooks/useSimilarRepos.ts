/**
 * 相似 Repository 的取得與重新計算。
 * 使用 React Query 管理快取與請求去重。
 */

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SimilarRepo, getSimilarRepos, calculateRepoSimilarities } from "../api/client";
import { useI18n } from "../i18n";
import { logger } from "../utils/logger";
import { queryKeys } from "../lib/react-query";

interface UseSimilarReposResult {
  similar: SimilarRepo[];
  loading: boolean;
  error: string | null;
  recalculate: () => Promise<void>;
  isRecalculating: boolean;
}

export function useSimilarRepos(repoId: number, limit: number = 5): UseSimilarReposResult {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [isRecalculating, setIsRecalculating] = useState(false);

  const query = useQuery<SimilarRepo[], Error>({
    queryKey: queryKeys.similarRepos.list(repoId, limit),
    queryFn: async () => {
      const response = await getSimilarRepos(repoId, limit);
      return response.similar;
    },
  });

  const recalculate = useCallback(async () => {
    setIsRecalculating(true);
    try {
      await calculateRepoSimilarities(repoId);
      // 計算完成後觸發重新載入
      await queryClient.invalidateQueries({
        queryKey: queryKeys.similarRepos.list(repoId, limit),
      });
    } catch (err) {
      logger.error("[SimilarRepos] 重新計算相似度失敗:", err);
    } finally {
      setIsRecalculating(false);
    }
  }, [repoId, limit, queryClient]);

  return {
    similar: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? (t.similarRepos.loadError as string) : null,
    recalculate,
    isRecalculating,
  };
}
