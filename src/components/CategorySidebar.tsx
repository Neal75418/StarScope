/**
 * Category sidebar component for organizing repositories.
 * Displays categories in a tree structure with create/edit capabilities.
 */

import { useState, useCallback, MouseEvent } from "react";
import { CategoryTreeNode, getCategory } from "../api/client";
import { useI18n } from "../i18n";
import { useCategoryTree } from "../hooks/useCategoryTree";
import { useCategoryExpand } from "../hooks/useCategoryExpand";
import {
  CategoryAddForm,
  CategoryEditModal,
  CategoryTreeNodeRenderer,
  CategorySidebarHeader,
  CategorySidebarLoading,
  CategorySidebarError,
} from "./category-sidebar";

interface CategorySidebarProps {
  selectedCategoryId: number | null;
  onSelectCategory: (categoryId: number | null) => void;
  onCategoriesChange?: () => void;
}

export function CategorySidebar({
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

  const handleEdit = useCallback(
    async (node: CategoryTreeNode, e: MouseEvent) => {
      e.stopPropagation();
      // Fetch fresh category data to ensure we have the latest
      try {
        const freshCategory = await getCategory(node.id);
        // Merge fresh data with tree node structure (preserving children)
        setEditingCategory({
          ...node,
          name: freshCategory.name,
          description: freshCategory.description,
          icon: freshCategory.icon,
          color: freshCategory.color,
        });
      } catch (err) {
        // Fallback to the tree node if fetch fails
        console.error("Failed to fetch category, using cached data:", err);
        setEditingCategory(node);
      }
    },
    []
  );

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
    async (categoryId: number, e: MouseEvent) => {
      e.stopPropagation();
      if (!confirm(t.categories.deleteConfirm)) return;

      const success = await handleDeleteCategory(categoryId);
      if (success && selectedCategoryId === categoryId) {
        onSelectCategory(null);
      }
    },
    [t, handleDeleteCategory, selectedCategoryId, onSelectCategory]
  );

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
        <CategoryAddForm
          onSubmit={handleCreateCategory}
          onCancel={() => setShowAddForm(false)}
        />
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
    </div>
  );
}
