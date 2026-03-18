/**
 * 分類拖曳排序：計算新 sort_order 並呼叫 API 更新。
 * 僅支援頂層分類排序。
 */

import { useState, useCallback } from "react";
import { CategoryTreeNode, CategoryUpdate, updateCategory } from "../api/client";
import { logger } from "../utils/logger";

interface UseCategoryReorderResult {
  reorder: (activeId: number, overId: number) => void;
  isReordering: boolean;
}

export function useCategoryReorder(
  tree: CategoryTreeNode[],
  onTreeChange: () => Promise<void>
): UseCategoryReorderResult {
  const [isReordering, setIsReordering] = useState(false);

  const reorder = useCallback(
    (activeId: number, overId: number) => {
      if (activeId === overId) return;

      const oldIndex = tree.findIndex((n) => n.id === activeId);
      const newIndex = tree.findIndex((n) => n.id === overId);
      if (oldIndex === -1 || newIndex === -1) return;

      // 計算新排序順序
      const reordered = [...tree];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      // 只更新 sort_order 實際改變的分類
      const changed = reordered
        .map((node, index) => ({ node, newOrder: index }))
        .filter(({ node, newOrder }) => node.sort_order !== newOrder);

      if (changed.length === 0) return;

      setIsReordering(true);
      const updates: Promise<unknown>[] = changed.map(({ node, newOrder }) => {
        const update: CategoryUpdate = { sort_order: newOrder };
        return updateCategory(node.id, update).catch((err) => {
          logger.error(`[CategoryReorder] 更新分類 ${node.id} 排序失敗:`, err);
          throw err; // 向上傳播，讓 Promise.all 能感知失敗
        });
      });

      void Promise.all(updates)
        .then(() => onTreeChange())
        .catch((err) => {
          logger.error("[CategoryReorder] 部分排序更新失敗，重新載入分類樹:", err);
          return onTreeChange(); // 失敗時仍刷新分類樹以回復一致狀態
        })
        .finally(() => setIsReordering(false));
    },
    [tree, onTreeChange]
  );

  return { reorder, isReordering };
}
