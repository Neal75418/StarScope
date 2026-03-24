/**
 * 可拖曳排序的分類列表（僅頂層分類）。
 * 使用 @dnd-kit/sortable 實作。
 */

import { useCallback, useMemo } from "react";
import type { MouseEvent } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CategoryTreeNode } from "../../api/client";
import { useI18n } from "../../i18n";
import { CategoryTreeNodeRenderer } from "./CategoryTreeNodeRenderer";

interface DraggableCategoryListProps {
  tree: CategoryTreeNode[];
  selectedCategoryId: number | null;
  isExpanded: (id: number) => boolean;
  onSelect: (id: number) => void;
  onToggleExpand: (id: number, e: MouseEvent) => void;
  onEdit: (node: CategoryTreeNode, e: MouseEvent) => void;
  onDelete: (id: number, e: MouseEvent) => void;
  onReorder: (activeId: number, overId: number) => void;
}

function SortableCategoryNode({
  node,
  selectedCategoryId,
  isExpanded,
  onSelect,
  onToggleExpand,
  onEdit,
  onDelete,
}: Omit<DraggableCategoryListProps, "tree" | "onReorder"> & { node: CategoryTreeNode }) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div className="category-drag-wrapper">
        <button
          className="category-drag-handle"
          {...listeners}
          aria-label={t.categories.dragToReorder}
          title={t.categories.dragToReorder}
          type="button"
        >
          ⠿
        </button>
        <div className="category-drag-content">
          <CategoryTreeNodeRenderer
            node={node}
            selectedCategoryId={selectedCategoryId}
            isExpanded={isExpanded}
            onSelect={onSelect}
            onToggleExpand={onToggleExpand}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      </div>
    </div>
  );
}

export function DraggableCategoryList({
  tree,
  selectedCategoryId,
  isExpanded,
  onSelect,
  onToggleExpand,
  onEdit,
  onDelete,
  onReorder,
}: DraggableCategoryListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const itemIds = useMemo(() => tree.map((n) => n.id), [tree]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        onReorder(active.id as number, over.id as number);
      }
    },
    [onReorder]
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {tree.map((node) => (
          <SortableCategoryNode
            key={node.id}
            node={node}
            selectedCategoryId={selectedCategoryId}
            isExpanded={isExpanded}
            onSelect={onSelect}
            onToggleExpand={onToggleExpand}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}
