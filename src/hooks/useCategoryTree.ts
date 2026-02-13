/**
 * 分類樹狀結構的取得與管理。
 */

import { useState, useEffect, useCallback, useRef } from "react";
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

  // 避免 StrictMode 重複請求
  const hasFetchedRef = useRef(false);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await getCategoryTree();
      setTree(response.tree);
    } catch (err) {
      logger.error("分類載入失敗:", err);
      setError(t.categories.loadError);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // 避免重複請求（防止 StrictMode 雙重觸發）
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    void fetchCategories();
    // fetchCategories 不需加入 deps：只需掛載時執行一次，hasFetchedRef 防止重複
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateCategory = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        await createCategory({ name });
        await fetchCategories();
        onCategoriesChange?.();
        return true;
      } catch (err) {
        logger.error("分類建立失敗:", err);
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
        logger.error("分類更新失敗:", err);
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
        logger.error("分類刪除失敗:", err);
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
