/**
 * Selection Mode 管理：支援多選搜尋結果並批次加入 watchlist。
 */

import { useState, useCallback } from "react";

export function useSelectionMode() {
  const [isActive, setIsActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const enter = useCallback(() => {
    setIsActive(true);
    setSelectedIds(new Set());
  }, []);

  const exit = useCallback(() => {
    setIsActive(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelection = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: number[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  return {
    isActive,
    selectedIds,
    selectedCount: selectedIds.size,
    enter,
    exit,
    toggleSelection,
    selectAll,
    clearSelection,
  };
}
