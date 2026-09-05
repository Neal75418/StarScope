/**
 * 分類拖曳排序：計算新 sort_order 並呼叫 API 更新。
 * 僅支援頂層分類排序。
 */

import { useState, useCallback, useRef } from "react";
import type { CategoryTreeNode, CategoryUpdate } from "../api/client";
import { updateCategory } from "../api/client";
import { logger } from "../utils/logger";

interface UseCategoryReorderResult {
  reorder: (activeId: number, overId: number) => Promise<void>;
  isReordering: boolean;
}

export function useCategoryReorder(
  tree: CategoryTreeNode[],
  onTreeChange: () => Promise<void>,
  // 沒有這個 callback 的話失敗只會進 logger，而 logger 在正式版是 no-op：
  // 拖曳失敗（或一半成功）對使用者完全無聲，清單跳到第三種排列也沒有解釋
  onError?: (err: unknown) => void
): UseCategoryReorderResult {
  const [isReordering, setIsReordering] = useState(false);
  const isReorderingRef = useRef(false);

  const reorder = useCallback(
    async (activeId: number, overId: number) => {
      if (activeId === overId) return;
      if (isReorderingRef.current) return;

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

      isReorderingRef.current = true;
      setIsReordering(true);
      const updates: Promise<unknown>[] = changed.map(async ({ node, newOrder }) => {
        const update: CategoryUpdate = { sort_order: newOrder };
        try {
          // await 不能省：省掉的話 promise 會直接被 return 出去，下面的 catch
          // 永遠不會執行，失敗的是哪一筆也就無從得知
          return await updateCategory(node.id, update);
        } catch (err) {
          logger.error(`[CategoryReorder] 更新分類 ${node.id} 排序失敗:`, err);
          throw err; // 向上傳播，讓 Promise.all 能感知失敗
        }
      });

      // 上面的重入防護要在第一個 await 之前完成——async 函式的本體會同步執行到
      // 第一個 await，所以 isReorderingRef 的檢查與設定仍然是原子的
      try {
        await Promise.all(updates);
        await onTreeChange();
      } catch (err) {
        logger.error("[CategoryReorder] 部分排序更新失敗，重新載入分類樹:", err);
        try {
          onError?.(err);
        } catch (handlerErr) {
          // 回報失敗的 handler 自己壞掉不能連帶跳過下面的刷新，否則清單停在半套用的排列
          logger.error("[CategoryReorder] onError handler 拋出:", handlerErr);
        }
        await onTreeChange(); // 失敗時仍刷新分類樹以回復一致狀態
      } finally {
        isReorderingRef.current = false;
        setIsReordering(false);
      }
    },
    [tree, onTreeChange, onError]
  );

  return { reorder, isReordering };
}
