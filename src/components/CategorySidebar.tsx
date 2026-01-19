/**
 * Category sidebar component for organizing repositories.
 * Displays categories in a tree structure with create/edit capabilities.
 */

import { useState, useEffect, FormEvent, MouseEvent } from "react";
import { CategoryTreeNode, getCategoryTree, createCategory, deleteCategory } from "../api/client";
import { useI18n } from "../i18n";

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
  const [tree, setTree] = useState<CategoryTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const fetchCategories = async () => {
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
  };

  useEffect(() => {
    void fetchCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    try {
      await createCategory({ name: newCategoryName.trim() });
      setNewCategoryName("");
      setShowAddForm(false);
      await fetchCategories();
      onCategoriesChange?.();
    } catch (err) {
      console.error("Failed to create category:", err);
    }
  };

  const handleDeleteCategory = async (categoryId: number, e: MouseEvent) => {
    e.stopPropagation();

    if (!confirm(t.categories.deleteConfirm)) {
      return;
    }

    try {
      await deleteCategory(categoryId);
      if (selectedCategoryId === categoryId) {
        onSelectCategory(null);
      }
      await fetchCategories();
      onCategoriesChange?.();
    } catch (err) {
      console.error("Failed to delete category:", err);
    }
  };

  const toggleExpanded = (categoryId: number, e: MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const renderTreeNode = (node: CategoryTreeNode, depth: number = 0) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isSelected = selectedCategoryId === node.id;

    return (
      <div key={node.id} className="category-node">
        <div
          className={`category-item ${isSelected ? "selected" : ""}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => onSelectCategory(node.id)}
        >
          {hasChildren && (
            <button className="category-expand-btn" onClick={(e) => toggleExpanded(node.id, e)}>
              {isExpanded ? "▼" : "▶"}
            </button>
          )}
          {!hasChildren && <span className="category-expand-spacer" />}

          {node.icon && <span className="category-icon">{node.icon}</span>}

          <span className="category-name" style={node.color ? { color: node.color } : undefined}>
            {node.name}
          </span>

          <span className="category-count">{node.repo_count}</span>

          <button
            className="category-delete-btn"
            onClick={(e) => handleDeleteCategory(node.id, e)}
            title={t.categories.deleteCategory}
          >
            &times;
          </button>
        </div>

        {hasChildren && isExpanded && (
          <div className="category-children">
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="category-sidebar">
        <div className="category-sidebar-header">
          <h3>{t.categories.title}</h3>
        </div>
        <div className="category-sidebar-loading">{t.categories.loading}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="category-sidebar">
        <div className="category-sidebar-header">
          <h3>{t.categories.title}</h3>
        </div>
        <div className="category-sidebar-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="category-sidebar">
      <div className="category-sidebar-header">
        <h3>{t.categories.title}</h3>
        <button
          className="btn btn-sm"
          onClick={() => setShowAddForm(!showAddForm)}
          title={t.categories.addCategory}
        >
          +
        </button>
      </div>

      {showAddForm && (
        <form className="category-add-form" onSubmit={handleCreateCategory}>
          <input
            type="text"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder={t.categories.namePlaceholder}
            autoFocus
          />
          <button type="submit" className="btn btn-sm btn-primary">
            {t.categories.add}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setShowAddForm(false);
              setNewCategoryName("");
            }}
          >
            {t.categories.cancel}
          </button>
        </form>
      )}

      <div className="category-list">
        <div
          className={`category-item all-repos ${selectedCategoryId === null ? "selected" : ""}`}
          onClick={() => onSelectCategory(null)}
        >
          <span className="category-expand-spacer" />
          <span className="category-name">{t.categories.allRepos}</span>
        </div>

        {tree.map((node) => renderTreeNode(node))}

        {tree.length === 0 && !showAddForm && (
          <div className="category-empty">{t.categories.empty}</div>
        )}
      </div>
    </div>
  );
}
