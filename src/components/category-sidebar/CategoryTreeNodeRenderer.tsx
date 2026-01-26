/**
 * Recursive renderer for category tree nodes.
 */

import { MouseEvent } from "react";
import { CategoryTreeNode } from "../../api/client";
import { CategoryNodeItem } from "./CategoryNodeItem";

interface CategoryTreeNodeRendererProps {
  node: CategoryTreeNode;
  depth?: number;
  selectedCategoryId: number | null;
  isExpanded: (id: number) => boolean;
  onSelect: (id: number) => void;
  onToggleExpand: (id: number, e: MouseEvent) => void;
  onEdit: (node: CategoryTreeNode, e: MouseEvent) => void;
  onDelete: (id: number, e: MouseEvent) => void;
}

export function CategoryTreeNodeRenderer({
  node,
  depth = 0,
  selectedCategoryId,
  isExpanded,
  onSelect,
  onToggleExpand,
  onEdit,
  onDelete,
}: CategoryTreeNodeRendererProps) {
  const hasChildren = node.children.length > 0;
  const expanded = isExpanded(node.id);
  const isSelected = selectedCategoryId === node.id;

  return (
    <div className="category-node">
      <CategoryNodeItem
        node={node}
        depth={depth}
        isSelected={isSelected}
        isExpanded={expanded}
        hasChildren={hasChildren}
        onSelect={onSelect}
        onToggleExpand={onToggleExpand}
        onEdit={onEdit}
        onDelete={onDelete}
      />

      {hasChildren && expanded && (
        <div className="category-children">
          {node.children.map((child) => (
            <CategoryTreeNodeRenderer
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedCategoryId={selectedCategoryId}
              isExpanded={isExpanded}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
