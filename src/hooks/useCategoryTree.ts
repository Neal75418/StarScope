/**
 * 分類樹狀結構的取得與管理。
 *
 * 資料放在 React Query（useCategoryTreeQuery），和 Dashboard 的分類摘要共用；追蹤名單或分類歸屬
 * 一變（invalidateTrackedRepos）就會跟著重讀，這裡只管分類結構本身的新增、改名、刪除。
 */

import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CategoryTreeNode, CategoryUpdate } from "../api/client";
import { createCategory, updateCategory, deleteCategory } from "../api/client";
import { invalidateTrackedRepos, queryKeys } from "../lib/react-query";
import { useCategoryTreeQuery } from "./useCategoryQueries";
import { useI18n } from "../i18n";
import { logger } from "../utils/logger";

interface UseCategoryTreeResult {
  tree: CategoryTreeNode[];
  loading: boolean;
  error: string | null;
  /** 有樹可顯示、但最近一次重讀失敗（畫面保留舊的樹，要另外提示） */
  reloadFailed: boolean;
  fetchCategories: () => Promise<void>;
  handleCreateCategory: (name: string) => Promise<boolean>;
  handleUpdateCategory: (categoryId: number, data: CategoryUpdate) => Promise<boolean>;
  handleDeleteCategory: (categoryId: number) => Promise<boolean>;
}

const EMPTY_TREE: CategoryTreeNode[] = [];

export function useCategoryTree(): UseCategoryTreeResult {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data, error, isPending, isLoadingError, isRefetchError, refetch } =
    useCategoryTreeQuery();

  useEffect(() => {
    if (error) logger.error("[CategoryTree] 分類載入失敗:", error);
  }, [error]);

  const fetchCategories = useCallback(async () => {
    await refetch();
  }, [refetch]);

  /** 分類結構變了（新增、改名）：只重讀樹，這些不改任何 repo 屬於哪些分類 */
  const reloadTree = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.repos.categoryTree() });
  }, [qc]);

  const handleCreateCategory = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        await createCategory({ name });
        reloadTree();
        return true;
      } catch (err) {
        logger.error("[CategoryTree] 分類建立失敗:", err);
        return false;
      }
    },
    [reloadTree]
  );

  const handleUpdateCategory = useCallback(
    async (categoryId: number, update: CategoryUpdate): Promise<boolean> => {
      try {
        await updateCategory(categoryId, update);
        reloadTree();
        return true;
      } catch (err) {
        logger.error("[CategoryTree] 分類更新失敗:", err);
        return false;
      }
    },
    [reloadTree]
  );

  const handleDeleteCategory = useCallback(
    async (categoryId: number): Promise<boolean> => {
      try {
        await deleteCategory(categoryId);
        // 刪掉的分類的成員關係跟著消失，各 repo 的 category_ids 要重讀：categories 沒有 AUTOINCREMENT，
        // 新分類可能重用這個 id，留著舊的 category_ids 會讓那些 repo 出現在新分類裡
        invalidateTrackedRepos(qc);
        return true;
      } catch (err) {
        logger.error("[CategoryTree] 分類刪除失敗:", err);
        return false;
      }
    },
    [qc]
  );

  return {
    tree: data?.tree ?? EMPTY_TREE,
    // 只有第一次載入顯示 Loading、只有從沒載入成功過才換成錯誤畫面：之後的重讀（或重讀失敗）
    // 都保留目前的樹，側欄上開著的編輯框與刪除確認才不會被整塊換掉而卸載
    loading: isPending,
    error: isLoadingError ? t.categories.loadError : null,
    reloadFailed: isRefetchError,
    fetchCategories,
    handleCreateCategory,
    handleUpdateCategory,
    handleDeleteCategory,
  };
}
