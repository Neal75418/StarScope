/**
 * 分類與 Repo 的關聯操作。
 */

import { useCallback, useState } from "react";
import { addRepoToCategory, removeRepoFromCategory, getRepoCategories } from "../api/client";
import { getErrorMessage } from "../utils/error";
import { logger } from "../utils/logger";

interface CategoryOperationsResult {
  isLoading: boolean;
  addToCategory: (categoryId: number, repoId: number) => Promise<boolean>;
  removeFromCategory: (categoryId: number, repoId: number) => Promise<boolean>;
  getCategories: (repoId: number) => Promise<{ id: number; name: string }[]>;
}

export function useCategoryOperations(
  onSuccess?: () => void,
  onError?: (msg: string) => void
): CategoryOperationsResult {
  const [isLoading, setIsLoading] = useState(false);

  // 工廠函數：統一處理分類操作的錯誤處理與載入狀態
  const createCategoryOperation = useCallback(
    (
      operation: (categoryId: number, repoId: number) => Promise<unknown>,
      errorLogPrefix: string,
      errorMessage: string
    ) =>
      async (categoryId: number, repoId: number): Promise<boolean> => {
        setIsLoading(true);
        try {
          await operation(categoryId, repoId);
          onSuccess?.();
          return true;
        } catch (err) {
          logger.error(errorLogPrefix, err);
          onError?.(getErrorMessage(err, errorMessage));
          return false;
        } finally {
          setIsLoading(false);
        }
      },
    [onSuccess, onError]
  );

  const addToCategory = useCallback(
    createCategoryOperation(
      addRepoToCategory,
      "[CategoryOps] Repo 加入分類失敗:",
      "Failed to add repo to category"
    ),
    [createCategoryOperation]
  );

  const removeFromCategory = useCallback(
    createCategoryOperation(
      removeRepoFromCategory,
      "[CategoryOps] Repo 移出分類失敗:",
      "Failed to remove repo from category"
    ),
    [createCategoryOperation]
  );

  const getCategories = useCallback(
    async (repoId: number): Promise<{ id: number; name: string }[]> => {
      try {
        const response = await getRepoCategories(repoId);
        return response.categories;
      } catch (err) {
        logger.error("[CategoryOps] 取得 Repo 分類失敗:", err);
        return [];
      }
    },
    []
  );

  return {
    isLoading,
    addToCategory,
    removeFromCategory,
    getCategories,
  };
}
