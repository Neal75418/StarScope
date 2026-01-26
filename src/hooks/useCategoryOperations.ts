/**
 * Hook for managing category-repo operations.
 */

import { useCallback, useState } from "react";
import {
  addRepoToCategory,
  removeRepoFromCategory,
  getRepoCategories,
} from "../api/client";

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
        console.error("Failed to add repo to category:", err);
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
        console.error("Failed to remove repo from category:", err);
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
        console.error("Failed to get repo categories:", err);
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
