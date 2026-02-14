/**
 * 分類側邊欄元件，以樹狀結構組織 repo 並支援新增 / 編輯。
 */

import { useState, useCallback, memo, MouseEvent } from "react";
import { CategoryTreeNode, getCategory } from "../api/client";
import { useI18n } from "../i18n";
import { useCategoryTree } from "../hooks/useCategoryTree";
import { useCategoryExpand } from "../hooks/useCategoryExpand";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  CategoryAddForm,
  CategoryEditModal,
  CategoryTreeNodeRenderer,
  CategorySidebarHeader,
  CategorySidebarLoading,
  CategorySidebarError,
} from "./category-sidebar";
import { logger } from "../utils/logger";

interface CategorySidebarProps {
  selectedCategoryId: number | null;
  onSelectCategory: (categoryId: number | null) => void;
  onCategoriesChange?: () => void;
}

export const CategorySidebar = memo(function CategorySidebar({
  selectedCategoryId,
  onSelectCategory,
  onCategoriesChange,
}: CategorySidebarProps) {
  const { t } = useI18n();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryTreeNode | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { tree, loading, error, handleCreateCategory, handleUpdateCategory, handleDeleteCategory } =
    useCategoryTree(onCategoriesChange);

  const { isExpanded, toggleExpanded } = useCategoryExpand();
  const deleteConfirm = useDeleteConfirm();

  const handleEdit = useCallback(async (node: CategoryTreeNode, e: MouseEvent) => {
    e.stopPropagation();
    // 取得最新的分類資料以確保一致性
    try {
      const freshCategory = await getCategory(node.id);
      // 合併最新資料與樹節點結構（保留 children）
      setEditingCategory({
        ...node,
        name: freshCategory.name,
        description: freshCategory.description,
        icon: freshCategory.icon,
        color: freshCategory.color,
      });
    } catch (err) {
      // 取得失敗時使用樹節點快取資料
      logger.error("分類載入失敗，使用快取資料:", err);
      setEditingCategory(node);
    }
  }, []);

  const handleEditSubmit = useCallback(
    async (categoryId: number, data: Parameters<typeof handleUpdateCategory>[1]) => {
      setIsSubmitting(true);
      try {
        return await handleUpdateCategory(categoryId, data);
      } finally {
        setIsSubmitting(false);
      }
    },
    [handleUpdateCategory]
  );

  const handleDelete = useCallback(
    (_categoryId: number, e: MouseEvent) => {
      e.stopPropagation();
      deleteConfirm.open(_categoryId);
    },
    [deleteConfirm]
  );

  const handleConfirmDelete = useCallback(async () => {
    if (deleteConfirm.itemId === null) return;
    const success = await handleDeleteCategory(deleteConfirm.itemId);
    if (success && selectedCategoryId === deleteConfirm.itemId) {
      onSelectCategory(null);
    }
    deleteConfirm.close();
  }, [deleteConfirm, handleDeleteCategory, selectedCategoryId, onSelectCategory]);

  if (loading) {
    return <CategorySidebarLoading />;
  }

  if (error) {
    return <CategorySidebarError error={error} />;
  }

  return (
    <div className="category-sidebar">
      <CategorySidebarHeader
        showAddForm={showAddForm}
        onToggleAddForm={() => setShowAddForm(!showAddForm)}
      />

      {showAddForm && (
        <CategoryAddForm onSubmit={handleCreateCategory} onCancel={() => setShowAddForm(false)} />
      )}

      <div className="category-list">
        <div
          className={`category-item all-repos ${selectedCategoryId === null ? "selected" : ""}`}
          onClick={() => onSelectCategory(null)}
        >
          <span className="category-expand-spacer" />
          <span className="category-name">{t.categories.allRepos}</span>
        </div>

        {tree.map((node) => (
          <CategoryTreeNodeRenderer
            key={node.id}
            node={node}
            selectedCategoryId={selectedCategoryId}
            isExpanded={isExpanded}
            onSelect={onSelectCategory}
            onToggleExpand={toggleExpanded}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        ))}

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
        message={t.categories.deleteConfirm}
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={deleteConfirm.close}
      />
    </div>
  );
});
