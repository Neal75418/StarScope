/**
 * 分類樹狀結構的取得與管理。
 */

import { useState, useCallback } from "react";
import { useOnceEffect } from "./useOnceEffect";
import {
  CategoryTreeNode,
  CategoryUpdate,
  getCategoryTree,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../api/client";
import { useI18n } from "../i18n";
import { logger } from "../utils/logger";

interface UseCategoryTreeResult {
  tree: CategoryTreeNode[];
  loading: boolean;
  error: string | null;
  fetchCategories: () => Promise<void>;
  handleCreateCategory: (name: string) => Promise<boolean>;
  handleUpdateCategory: (categoryId: number, data: CategoryUpdate) => Promise<boolean>;
  handleDeleteCategory: (categoryId: number) => Promise<boolean>;
}

export function useCategoryTree(onCategoriesChange?: () => void): UseCategoryTreeResult {
  const { t } = useI18n();
  const [tree, setTree] = useState<CategoryTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await getCategoryTree();
      setTree(response.tree);
    } catch (err) {
      logger.error("[CategoryTree] 分類載入失敗:", err);
      setError(t.categories.loadError);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useOnceEffect(() => {
    void fetchCategories();
  });

  const handleCreateCategory = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        await createCategory({ name });
        await fetchCategories();
        onCategoriesChange?.();
        return true;
      } catch (err) {
        logger.error("[CategoryTree] 分類建立失敗:", err);
        return false;
      }
    },
    [fetchCategories, onCategoriesChange]
  );

  const handleUpdateCategory = useCallback(
    async (categoryId: number, data: CategoryUpdate): Promise<boolean> => {
      try {
        await updateCategory(categoryId, data);
        await fetchCategories();
        onCategoriesChange?.();
        return true;
      } catch (err) {
        logger.error("[CategoryTree] 分類更新失敗:", err);
        return false;
      }
    },
    [fetchCategories, onCategoriesChange]
  );

  const handleDeleteCategory = useCallback(
    async (categoryId: number): Promise<boolean> => {
      try {
        await deleteCategory(categoryId);
        await fetchCategories();
        onCategoriesChange?.();
        return true;
      } catch (err) {
        logger.error("[CategoryTree] 分類刪除失敗:", err);
        return false;
      }
    },
    [fetchCategories, onCategoriesChange]
  );

  return {
    tree,
    loading,
    error,
    fetchCategories,
    handleCreateCategory,
    handleUpdateCategory,
    handleDeleteCategory,
  };
}
