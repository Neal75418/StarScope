/**
 * 把 repo 移出分類。
 */

import { useCallback } from "react";
import { removeRepoFromCategory } from "../api/client";
import { getErrorMessage } from "../utils/error";
import { logger } from "../utils/logger";
import { useI18n } from "../i18n";

interface CategoryOperationsResult {
  removeFromCategory: (categoryId: number, repoId: number) => Promise<boolean>;
}

export function useCategoryOperations(
  onSuccess?: () => void,
  onError?: (msg: string) => void
): CategoryOperationsResult {
  const { t } = useI18n();

  const removeFromCategory = useCallback(
    async (categoryId: number, repoId: number): Promise<boolean> => {
      try {
        await removeRepoFromCategory(categoryId, repoId);
        onSuccess?.();
        return true;
      } catch (err) {
        logger.error("[CategoryOps] Repo 移出分類失敗:", err);
        onError?.(getErrorMessage(err, t.categories.removeFailed));
        return false;
      }
    },
    [onSuccess, onError, t]
  );

  return { removeFromCategory };
}
