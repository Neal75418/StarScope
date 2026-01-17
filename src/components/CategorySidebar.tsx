/**
 * Category sidebar component for organizing repositories.
 * Displays categories in a tree structure with create/edit capabilities.
 */

import { useState, useEffect } from "react";
import {
  CategoryTreeNode,
  getCategoryTree,
  createCategory,
  deleteCategory,
} from "../api/client";

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
      setError("Failed to load categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    try {
      await createCategory({ name: newCategoryName.trim() });
      setNewCategoryName("");
      setShowAddForm(false);
      fetchCategories();
      onCategoriesChange?.();
    } catch (err) {
      console.error("Failed to create category:", err);
    }
  };

  const handleDeleteCategory = async (categoryId: number, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!confirm("Are you sure you want to delete this category?")) {
      return;
    }

    try {
      await deleteCategory(categoryId);
      if (selectedCategoryId === categoryId) {
        onSelectCategory(null);
      }
      fetchCategories();
      onCategoriesChange?.();
    } catch (err) {
      console.error("Failed to delete category:", err);
    }
  };

  const toggleExpanded = (categoryId: number, e: React.MouseEvent) => {
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
            <button
              className="category-expand-btn"
              onClick={(e) => toggleExpanded(node.id, e)}
            >
              {isExpanded ? "▼" : "▶"}
            </button>
          )}
          {!hasChildren && <span className="category-expand-spacer" />}

          {node.icon && <span className="category-icon">{node.icon}</span>}

          <span
            className="category-name"
            style={node.color ? { color: node.color } : undefined}
          >
            {node.name}
          </span>

          <span className="category-count">{node.repo_count}</span>

          <button
            className="category-delete-btn"
            onClick={(e) => handleDeleteCategory(node.id, e)}
            title="Delete category"
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
          <h3>Categories</h3>
        </div>
        <div className="category-sidebar-loading">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="category-sidebar">
        <div className="category-sidebar-header">
          <h3>Categories</h3>
        </div>
        <div className="category-sidebar-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="category-sidebar">
      <div className="category-sidebar-header">
        <h3>Categories</h3>
        <button
          className="btn btn-sm"
          onClick={() => setShowAddForm(!showAddForm)}
          title="Add category"
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
            placeholder="Category name"
            autoFocus
          />
          <button type="submit" className="btn btn-sm btn-primary">
            Add
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setShowAddForm(false);
              setNewCategoryName("");
            }}
          >
            Cancel
          </button>
        </form>
      )}

      <div className="category-list">
        <div
          className={`category-item all-repos ${selectedCategoryId === null ? "selected" : ""}`}
          onClick={() => onSelectCategory(null)}
        >
          <span className="category-expand-spacer" />
          <span className="category-name">All Repositories</span>
        </div>

        {tree.map((node) => renderTreeNode(node))}

        {tree.length === 0 && !showAddForm && (
          <div className="category-empty">
            No categories yet. Click + to create one.
          </div>
        )}
      </div>
    </div>
  );
}

interface AddToCategoryDropdownProps {
  repoId: number;
  onAdd: (categoryId: number) => Promise<void>;
}

export function AddToCategoryDropdown({ repoId: _repoId, onAdd }: AddToCategoryDropdownProps) {
  const [tree, setTree] = useState<CategoryTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      getCategoryTree()
        .then((response) => setTree(response.tree))
        .catch((err) => console.error("Failed to load categories:", err))
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  const handleSelect = async (categoryId: number) => {
    try {
      await onAdd(categoryId);
      setIsOpen(false);
    } catch (err) {
      console.error("Failed to add to category:", err);
    }
  };

  const flattenTree = (nodes: CategoryTreeNode[]): CategoryTreeNode[] => {
    const result: CategoryTreeNode[] = [];
    const flatten = (items: CategoryTreeNode[]) => {
      for (const item of items) {
        result.push(item);
        if (item.children.length > 0) {
          flatten(item.children);
        }
      }
    };
    flatten(nodes);
    return result;
  };

  if (!isOpen) {
    return (
      <button
        className="btn btn-sm"
        onClick={() => setIsOpen(true)}
        title="Add to category"
      >
        + Category
      </button>
    );
  }

  const flatCategories = flattenTree(tree);

  return (
    <div className="category-dropdown">
      <div className="category-dropdown-header">
        <span>Add to Category</span>
        <button className="btn btn-sm" onClick={() => setIsOpen(false)}>
          &times;
        </button>
      </div>
      {loading ? (
        <div className="category-dropdown-loading">Loading...</div>
      ) : flatCategories.length === 0 ? (
        <div className="category-dropdown-empty">No categories</div>
      ) : (
        <div className="category-dropdown-list">
          {flatCategories.map((cat) => (
            <button
              key={cat.id}
              className="category-dropdown-item"
              onClick={() => handleSelect(cat.id)}
            >
              {cat.icon && <span className="category-icon">{cat.icon}</span>}
              {cat.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
