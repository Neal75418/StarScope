/**
 * 分類樹狀結構的取得與管理。
 */

import { useState, useCallback, useRef } from "react";
import { useOnceEffect } from "./useOnceEffect";
import type { CategoryTreeNode, CategoryUpdate } from "../api/client";
import { getCategoryTree, createCategory, updateCategory, deleteCategory } from "../api/client";
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

  const fetchIdRef = useRef(0);

  const fetchCategories = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const response = await getCategoryTree();
      // 只接受最新一次 fetch 的結果，丟棄被超越的舊回應
      if (fetchId !== fetchIdRef.current) return;
      setTree(response.tree);
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      logger.error("[CategoryTree] 分類載入失敗:", err);
      setError(t.categories.loadError);
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [t]);

  useOnceEffect(() => {
    void fetchCategories();
  });

  /** 執行 mutation 後，背景刷新樹狀結構（reload 失敗不影響 mutation 結果） */
  const reloadAfterMutation = useCallback(() => {
    fetchCategories().catch((err) => {
      logger.warn("[CategoryTree] mutation 成功但 reload 失敗，下次操作會重新載入:", err);
    });
    onCategoriesChange?.();
  }, [fetchCategories, onCategoriesChange]);

  const handleCreateCategory = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        await createCategory({ name });
        reloadAfterMutation();
        return true;
      } catch (err) {
        logger.error("[CategoryTree] 分類建立失敗:", err);
        return false;
      }
    },
    [reloadAfterMutation]
  );

  const handleUpdateCategory = useCallback(
    async (categoryId: number, data: CategoryUpdate): Promise<boolean> => {
      try {
        await updateCategory(categoryId, data);
        reloadAfterMutation();
        return true;
      } catch (err) {
        logger.error("[CategoryTree] 分類更新失敗:", err);
        return false;
      }
    },
    [reloadAfterMutation]
  );

  const handleDeleteCategory = useCallback(
    async (categoryId: number): Promise<boolean> => {
      try {
        await deleteCategory(categoryId);
        reloadAfterMutation();
        return true;
      } catch (err) {
        logger.error("[CategoryTree] 分類刪除失敗:", err);
        return false;
      }
    },
    [reloadAfterMutation]
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
