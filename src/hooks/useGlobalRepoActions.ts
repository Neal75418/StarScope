/**
 * 全域 Repo 操作（重新計算相似度等）。
 */

import { useState, useCallback } from "react";
import { recalculateAllSimilarities } from "../api/client";
import { useI18n } from "../i18n";
import { logger } from "../utils/logger";

interface Toast {
  success: (msg: string) => void;
  error: (msg: string) => void;
}

export function useGlobalRepoActions(toast: Toast) {
  const { t } = useI18n();
  const [isRecalculatingSimilarities, setIsRecalculatingSimilarities] = useState(false);

  // 重新計算所有相似度
  const handleRecalculateAll = useCallback(async () => {
    setIsRecalculatingSimilarities(true);
    try {
      const result = await recalculateAllSimilarities();
      toast.success(
        t.watchlist.recalculateComplete
          ? t.watchlist.recalculateComplete
              .replace("{repos}", String(result.processed))
              .replace("{similarities}", String(result.similarities_found))
          : `已處理 ${result.processed} 個 Repo，找到 ${result.similarities_found} 筆相似度`
      );
    } catch (err) {
      logger.error("重新計算相似度失敗:", err);
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
