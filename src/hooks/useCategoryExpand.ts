/**
 * 分類樹節點展開 / 收合狀態管理。
 */

import { useState, useCallback, MouseEvent } from "react";

interface UseCategoryExpandResult {
  expandedIds: Set<number>;
  isExpanded: (id: number) => boolean;
  toggleExpanded: (categoryId: number, e: MouseEvent) => void;
}

export function useCategoryExpand(): UseCategoryExpandResult {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const isExpanded = useCallback((id: number) => expandedIds.has(id), [expandedIds]);

  const toggleExpanded = useCallback((categoryId: number, e: MouseEvent) => {
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
  }, []);

  return { expandedIds, isExpanded, toggleExpanded };
}
