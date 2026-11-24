/**
 * 分類側邊欄元件，以樹狀結構組織 repo 並支援新增 / 編輯。
 */

import { useState, useCallback, useEffect, useRef, memo } from "react";
import type { MouseEvent } from "react";
import { CategoryTreeNode, CategoryEditFields, CategoryUpdate, getCategory } from "../api/client";
import { interpolate, useI18n } from "../i18n";
import { useCategoryExpand } from "../hooks/useCategoryExpand";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  CategoryAddForm,
  CategoryEditModal,
  CategorySidebarHeader,
  CategorySidebarLoading,
  CategorySidebarError,
} from "./category-sidebar";
import { DraggableCategoryList } from "./category-sidebar/DraggableCategoryList";
import { useCategoryReorder } from "../hooks/useCategoryReorder";
import { useWatchlistActions } from "../contexts/WatchlistContext";
import { getErrorMessage } from "../utils/error";
import { logger } from "../utils/logger";
import { describeWriteFailure, isRequestTimeout } from "../utils/writeFailure";
import { ApiError } from "../api/types";
import type { CategoryWriteResult } from "../hooks/useCategoryTree";

export interface CategoryTreeData {
  tree: CategoryTreeNode[];
  loading: boolean;
  error: string | null;
  fetchCategories: () => Promise<void>;
  handleCreateCategory: (name: string) => Promise<boolean>;
  handleUpdateCategory: (categoryId: number, data: CategoryUpdate) => Promise<CategoryWriteResult>;
  handleDeleteCategory: (categoryId: number) => Promise<CategoryWriteResult>;
}

/** 樹裡某個分類的名稱（含子分類）；找不到回 null */
function findCategoryName(nodes: CategoryTreeNode[], id: number): string | null {
  for (const node of nodes) {
    if (node.id === id) return node.name;
    const inChildren = findCategoryName(node.children ?? [], id);
    if (inChildren !== null) return inChildren;
  }
  return null;
}

/**
 * 分類已經不在：被別處刪了，或上一次刪除逾時、其實已經做完。編輯框只送 CategoryEditFields（沒有 parent_id），
 * 所以讀取、更新、刪除回 404 都只會是分類本身不在（不會是父分類不在）
 */
function isCategoryGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * 逾時只是不確定有沒有做成，用警告；其餘是這一次沒做成，用錯誤（5xx 也可能做了一部分，所以失敗後一律重讀）
 */
function failureToastType(error: unknown): "warning" | "error" {
  return isRequestTimeout(error) ? "warning" : "error";
}

interface CategorySidebarProps {
  selectedCategoryId: number | null;
  onSelectCategory: (categoryId: number | null) => void;
  categoryTree: CategoryTreeData;
}

export const CategorySidebar = memo(function CategorySidebar({
  selectedCategoryId,
  onSelectCategory,
  categoryTree,
}: CategorySidebarProps) {
  const { t } = useI18n();
  const [showAddForm, setShowAddForm] = useState(false);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryTreeNode | null>(null);
  const [deleteTargetName, setDeleteTargetName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const editRequestIdRef = useRef(0);

  const {
    tree,
    loading,
    error,
    fetchCategories,
    handleCreateCategory,
    handleUpdateCategory,
    handleDeleteCategory,
  } = categoryTree;

  const { isExpanded, toggleExpanded } = useCategoryExpand();
  const deleteConfirm = useDeleteConfirm();
  const { showToast, invalidateRepos } = useWatchlistActions();

  // 選取跟著樹走：分類在別處被刪了、或刪除逾時其實已經做完，樹重讀之後選取還指著它的話，側欄沒有任何一項
  // 是選取的、主畫面也是空的。樹還沒讀到（載入中、讀取失敗）時樹是空的，不能拿來判斷
  useEffect(() => {
    if (loading || error !== null || selectedCategoryId === null) return;
    if (findCategoryName(tree, selectedCategoryId) === null) onSelectCategory(null);
  }, [tree, loading, error, selectedCategoryId, onSelectCategory]);
  const handleReorderError = useCallback(
    (err: unknown) =>
      showToast(
        "error",
        interpolate(t.categories.reorderFailed, { reason: getErrorMessage(err, t.common.error) })
      ),
    [showToast, t]
  );
  const { reorder } = useCategoryReorder(tree, fetchCategories, handleReorderError);

  const handleCreate = useCallback(
    async (name: string): Promise<boolean> => {
      setIsAddingCategory(true);
      try {
        return await handleCreateCategory(name);
      } finally {
        setIsAddingCategory(false);
      }
    },
    [handleCreateCategory]
  );

  const handleEdit = useCallback(
    async (node: CategoryTreeNode, e: MouseEvent) => {
      e.stopPropagation();
      // 用遞增 ID 防止連點時慢回應覆蓋快回應（stale-response race）
      const requestId = ++editRequestIdRef.current;
      try {
        const freshCategory = await getCategory(node.id);
        if (requestId !== editRequestIdRef.current) return; // 已被更新的請求取代
        setEditingCategory({
          ...node,
          name: freshCategory.name,
          description: freshCategory.description,
          icon: freshCategory.icon,
          color: freshCategory.color,
        });
      } catch (err) {
        if (requestId !== editRequestIdRef.current) return;
        if (isCategoryGone(err)) {
          // 打開框讓人填完才說存不進去，打的字會白費；重讀後它會從樹上消失，選取也會跟著放掉
          showToast("info", interpolate(t.categories.alreadyGone, { name: node.name }));
          invalidateRepos();
          return;
        }
        logger.error("[CategorySidebar] 分類載入失敗，使用快取資料:", err);
        setEditingCategory(node);
      }
    },
    [showToast, invalidateRepos, t]
  );

  const handleEditSubmit = useCallback(
    async (categoryId: number, data: CategoryEditFields) => {
      setIsSubmitting(true);
      try {
        const result = await handleUpdateCategory(categoryId, data);
        if (result.ok) return true;
        // 改名沒有成功，所以提示用它現在的名字，不是剛打進去的新名字
        const name = findCategoryName(tree, categoryId) ?? data.name ?? "";
        if (isCategoryGone(result.error)) {
          // 留著框也存不進去：回 true 讓編輯框關掉。用警告：打好的變更沒有存到，但不是重試能解決的錯誤
          showToast("warning", interpolate(t.categories.updateFailed.gone, { name }));
          return true;
        }
        // 對話框留著讓人重試，但要說出這一下沒有成功與原因：否則按鈕只是從「儲存中」變回「儲存」
        showToast(
          failureToastType(result.error),
          describeWriteFailure(result.error, t, {
            notDone: interpolate(t.categories.updateFailed.notDone, { name }),
            timedOut: interpolate(t.categories.updateFailed.timedOut, { name }),
          })
        );
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [handleUpdateCategory, tree, showToast, t]
  );

  const handleDelete = useCallback(
    (categoryId: number, e: MouseEvent) => {
      e.stopPropagation();
      // 名稱在打開確認框的當下記下來：之後樹重讀也不影響框裡與失敗提示寫的是哪一個
      setDeleteTargetName(findCategoryName(tree, categoryId) ?? "");
      deleteConfirm.open(categoryId);
    },
    [deleteConfirm, tree]
  );

  const handleConfirmDelete = useCallback(async () => {
    if (deleteConfirm.itemId === null) return;
    setIsDeleting(true);
    try {
      const result = await handleDeleteCategory(deleteConfirm.itemId);
      // 已經不在＝使用者要的結果已經達成（例如上一次逾時、其實刪掉了），照刪除成功處理
      const alreadyGone = !result.ok && isCategoryGone(result.error);
      if (result.ok || alreadyGone) {
        if (selectedCategoryId === deleteConfirm.itemId) {
          onSelectCategory(null);
        }
        deleteConfirm.close();
        if (alreadyGone) {
          showToast("info", interpolate(t.categories.alreadyGone, { name: deleteTargetName }));
        }
      } else {
        // 失敗時保留 dialog 開啟讓使用者可以重試，並說出這一下沒有成功與原因
        showToast(
          failureToastType(result.error),
          describeWriteFailure(result.error, t, {
            notDone: interpolate(t.categories.deleteFailed.notDone, { name: deleteTargetName }),
            timedOut: interpolate(t.categories.deleteFailed.timedOut, { name: deleteTargetName }),
          })
        );
      }
    } finally {
      setIsDeleting(false);
    }
  }, [
    deleteConfirm,
    handleDeleteCategory,
    selectedCategoryId,
    onSelectCategory,
    showToast,
    t,
    deleteTargetName,
  ]);

  if (loading) {
    return <CategorySidebarLoading />;
  }

  if (error) {
    return <CategorySidebarError error={error} onRetry={fetchCategories} />;
  }

  return (
    <div className="category-sidebar">
      <CategorySidebarHeader
        showAddForm={showAddForm}
        onToggleAddForm={() => setShowAddForm(!showAddForm)}
        disabled={isAddingCategory}
      />

      {showAddForm && (
        <CategoryAddForm onSubmit={handleCreate} onCancel={() => setShowAddForm(false)} />
      )}

      <div className="category-list">
        <div
          className={`category-item all-repos ${selectedCategoryId === null ? "selected" : ""}`}
          onClick={() => onSelectCategory(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectCategory(null);
            }
          }}
          role="button"
          tabIndex={0}
          aria-pressed={selectedCategoryId === null}
        >
          <span className="category-expand-spacer" />
          <span className="category-name">{t.categories.allRepos}</span>
        </div>

        <DraggableCategoryList
          tree={tree}
          selectedCategoryId={selectedCategoryId}
          isExpanded={isExpanded}
          onSelect={onSelectCategory}
          onToggleExpand={toggleExpanded}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onReorder={reorder}
        />

        {tree.length === 0 && !showAddForm && (
          <div className="category-empty">{t.categories.empty}</div>
        )}
      </div>

      {editingCategory && (
        <CategoryEditModal
          category={editingCategory}
          isSubmitting={isSubmitting}
          onSubmit={handleEditSubmit}
          onClose={() => setEditingCategory(null)}
        />
      )}

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title={t.categories.deleteCategory}
        message={interpolate(t.categories.deleteConfirm, { name: deleteTargetName })}
        confirmText={t.categories.deleteCategory}
        variant="danger"
        isProcessing={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={deleteConfirm.close}
      />
    </div>
  );
});
