/**
 * Hook for fetching and managing category tree.
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

  // Prevent duplicate fetches from StrictMode
  const hasFetchedRef = useRef(false);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await getCategoryTree();
      setTree(response.tree);
    } catch (err) {
      console.error("Failed to load categories:", err);
      setError(t.categories.loadError);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // Skip if already fetched (prevents StrictMode double-fetch)
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    void fetchCategories();
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
        console.error("Failed to create category:", err);
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
        console.error("Failed to update category:", err);
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
        console.error("Failed to delete category:", err);
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
