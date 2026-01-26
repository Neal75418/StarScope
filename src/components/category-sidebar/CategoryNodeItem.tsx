/**
 * Single category node item in the tree.
 */

import { MouseEvent } from "react";
import { CategoryTreeNode } from "../../api/client";
import { useI18n } from "../../i18n";

interface CategoryNodeItemProps {
  node: CategoryTreeNode;
  depth: number;
  isSelected: boolean;
  isExpanded: boolean;
  hasChildren: boolean;
  onSelect: (id: number) => void;
  onToggleExpand: (id: number, e: MouseEvent) => void;
  onEdit: (node: CategoryTreeNode, e: MouseEvent) => void;
  onDelete: (id: number, e: MouseEvent) => void;
}

export function CategoryNodeItem({
  node,
  depth,
  isSelected,
  isExpanded,
  hasChildren,
  onSelect,
  onToggleExpand,
  onEdit,
  onDelete,
}: CategoryNodeItemProps) {
  const { t } = useI18n();

  return (
    <div
      className={`category-item ${isSelected ? "selected" : ""}`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={() => onSelect(node.id)}
    >
      {hasChildren ? (
        <button
          className="category-expand-btn"
          onClick={(e) => onToggleExpand(node.id, e)}
        >
          {isExpanded ? "▼" : "▶"}
        </button>
      ) : (
        <span className="category-expand-spacer" />
      )}

      {node.icon && <span className="category-icon">{node.icon}</span>}

      <span
        className="category-name"
        style={node.color ? { color: node.color } : undefined}
      >
        {node.name}
      </span>

      <span className="category-count">{node.repo_count}</span>

      <button
        className="category-edit-btn"
        onClick={(e) => onEdit(node, e)}
        title={t.categories.editCategory}
      >
        &#9998;
      </button>

      <button
        className="category-delete-btn"
        onClick={(e) => onDelete(node.id, e)}
        title={t.categories.deleteCategory}
      >
        &times;
      </button>
    </div>
  );
}
