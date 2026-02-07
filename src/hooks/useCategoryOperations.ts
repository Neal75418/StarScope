/**
 * 分類與 Repo 的關聯操作。
 */

import { useCallback, useState } from "react";
import { addRepoToCategory, removeRepoFromCategory, getRepoCategories } from "../api/client";
import { logger } from "../utils/logger";

interface CategoryOperationsResult {
  isLoading: boolean;
  addToCategory: (categoryId: number, repoId: number) => Promise<boolean>;
  removeFromCategory: (categoryId: number, repoId: number) => Promise<boolean>;
  getCategories: (repoId: number) => Promise<{ id: number; name: string }[]>;
}

export function useCategoryOperations(onSuccess?: () => void): CategoryOperationsResult {
  const [isLoading, setIsLoading] = useState(false);

  const addToCategory = useCallback(
    async (categoryId: number, repoId: number): Promise<boolean> => {
      setIsLoading(true);
      try {
        await addRepoToCategory(categoryId, repoId);
        onSuccess?.();
        return true;
      } catch (err) {
        logger.error("Repo 加入分類失敗:", err);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [onSuccess]
  );

  const removeFromCategory = useCallback(
    async (categoryId: number, repoId: number): Promise<boolean> => {
      setIsLoading(true);
      try {
        await removeRepoFromCategory(categoryId, repoId);
        onSuccess?.();
        return true;
      } catch (err) {
        logger.error("Repo 移出分類失敗:", err);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [onSuccess]
  );

  const getCategories = useCallback(
    async (repoId: number): Promise<{ id: number; name: string }[]> => {
      try {
        const response = await getRepoCategories(repoId);
        return response.categories;
      } catch (err) {
        logger.error("取得 Repo 分類失敗:", err);
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
