/**
 * Watchlist 批次操作：加入分類、批次刷新、批次移除。
 * 逐一操作 + 收集結果，避免 Promise.all fast-fail。
 */

import { useState, useCallback } from "react";
import { addRepoToCategory, removeRepo, fetchRepo } from "../api/client";
import type { WatchlistActions } from "../contexts/watchlistReducer";

interface BatchResult {
  success: number;
  failed: number;
  total: number;
}

export function useWatchlistBatchActions(selectedIds: Set<number>, actions: WatchlistActions) {
  const [isProcessing, setIsProcessing] = useState(false);

  const batchAddToCategory = useCallback(
    async (categoryId: number): Promise<BatchResult & { failedIds: number[] }> => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return { success: 0, failed: 0, total: 0, failedIds: [] };

      setIsProcessing(true);
      let success = 0;
      let failed = 0;
      const failedIds: number[] = [];

      try {
        for (const repoId of ids) {
          try {
            await addRepoToCategory(categoryId, repoId);
            success++;
          } catch {
            failed++;
            failedIds.push(repoId);
          }
        }
        await actions.refreshAll();
      } finally {
        setIsProcessing(false);
      }
      return { success, failed, total: ids.length, failedIds };
    },
    [selectedIds, actions]
  );

  const batchRefresh = useCallback(async (): Promise<BatchResult> => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return { success: 0, failed: 0, total: 0 };

    setIsProcessing(true);
    let success = 0;
    let failed = 0;

    try {
      for (const repoId of ids) {
        try {
          await fetchRepo(repoId);
          success++;
        } catch {
          failed++;
        }
      }
      await actions.refreshAll();
    } finally {
      setIsProcessing(false);
    }
    return { success, failed, total: ids.length };
  }, [selectedIds, actions]);

  const batchRemove = useCallback(async (): Promise<BatchResult & { failedIds: number[] }> => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return { success: 0, failed: 0, total: 0, failedIds: [] };

    setIsProcessing(true);
    let success = 0;
    let failed = 0;
    const failedIds: number[] = [];

    try {
      for (const repoId of ids) {
        try {
          await removeRepo(repoId);
          success++;
        } catch {
          failed++;
          failedIds.push(repoId);
        }
      }
      await actions.refreshAll();
    } finally {
      setIsProcessing(false);
    }
    return { success, failed, total: ids.length, failedIds };
  }, [selectedIds, actions]);

  return {
    batchAddToCategory,
    batchRefresh,
    batchRemove,
    isProcessing,
  };
}
