/**
 * 分類側邊欄元件，以樹狀結構組織 repo 並支援新增 / 編輯。
 */

import { useState, useCallback, useRef, memo } from "react";
import type { MouseEvent } from "react";
import { CategoryTreeNode, CategoryUpdate, getCategory } from "../api/client";
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

export interface CategoryTreeData {
  tree: CategoryTreeNode[];
  loading: boolean;
  error: string | null;
  fetchCategories: () => Promise<void>;
  handleCreateCategory: (name: string) => Promise<boolean>;
  handleUpdateCategory: (categoryId: number, data: CategoryUpdate) => Promise<boolean>;
  handleDeleteCategory: (categoryId: number) => Promise<boolean>;
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
  const { showToast } = useWatchlistActions();
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

  const handleEdit = useCallback(async (node: CategoryTreeNode, e: MouseEvent) => {
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
      logger.error("[CategorySidebar] 分類載入失敗，使用快取資料:", err);
      setEditingCategory(node);
    }
  }, []);

  const handleEditSubmit = useCallback(
    async (categoryId: number, data: Parameters<typeof handleUpdateCategory>[1]) => {
      setIsSubmitting(true);
      try {
        const saved = await handleUpdateCategory(categoryId, data);
        // 對話框留著讓人重試，但要說出這一下沒有成功：否則按鈕只是從「儲存中」變回「儲存」
        if (!saved) {
          const name = findCategoryName(tree, categoryId) ?? data.name ?? "";
          showToast("error", interpolate(t.categories.updateFailed, { name }));
        }
        return saved;
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
      const success = await handleDeleteCategory(deleteConfirm.itemId);
      if (success) {
        if (selectedCategoryId === deleteConfirm.itemId) {
          onSelectCategory(null);
        }
        deleteConfirm.close();
      } else {
        // 失敗時保留 dialog 開啟讓使用者可以重試，並說出這一下沒有成功
        showToast("error", interpolate(t.categories.deleteFailed, { name: deleteTargetName }));
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
