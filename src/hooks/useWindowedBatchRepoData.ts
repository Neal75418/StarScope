/**
 * 視窗化批次載入：僅載入可見範圍內的 repo 資料，而非全部。
 * 減少初始載入時間與記憶體使用。
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ContextBadge,
  EarlySignal,
  getContextBadgesBatch,
  getRepoSignalsBatch,
} from "../api/client";

export interface BatchRepoData {
  badges: ContextBadge[];
  signals: EarlySignal[];
}

const MAX_BATCH_SIZE = 50;
const EMPTY_BADGES: ContextBadge[] = [];
const EMPTY_SIGNALS: EarlySignal[] = [];

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

interface VisibleRange {
  start: number;
  stop: number;
}

interface UseWindowedBatchRepoDataOptions {
  bufferSize?: number;
  debounceMs?: number;
}

interface UseWindowedBatchRepoDataResult {
  dataMap: Record<number, BatchRepoData>;
  loading: boolean;
  error: Error | null;
  setVisibleRange: (range: VisibleRange) => void;
}

/**
 * 視窗化批次載入 hook
 *
 * @param allRepoIds - 所有 repo IDs（完整列表）
 * @param options.bufferSize - 視窗上下額外載入的項目數（預設 10）
 * @param options.debounceMs - 資料載入 debounce 延遲（毫秒，預設 150）
 * @returns dataMap, loading, error, setVisibleRange
 */
export function useWindowedBatchRepoData(
  allRepoIds: number[],
  options: UseWindowedBatchRepoDataOptions = {}
): UseWindowedBatchRepoDataResult {
  const { bufferSize = 10, debounceMs = 150 } = options;

  const [visibleRange, setVisibleRange] = useState<VisibleRange>({ start: 0, stop: 20 });
  const [debouncedVisibleRange, setDebouncedVisibleRange] = useState<VisibleRange>({
    start: 0,
    stop: 20,
  });
  const [badgesMap, setBadgesMap] = useState<Record<string, { badges: ContextBadge[] }>>({});
  const [signalsMap, setSignalsMap] = useState<Record<string, { signals: EarlySignal[] }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const loadingIdsRef = useRef<Set<number>>(new Set());

  // Debounce visibleRange 更新，避免快速滾動時過多請求
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedVisibleRange(visibleRange);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [visibleRange, debounceMs]);

  // 計算需要載入的 repo IDs（視窗範圍 + buffer）
  // 使用 debouncedVisibleRange 避免快速滾動時過多請求
  const targetIds = useMemo(() => {
    const start = Math.max(0, debouncedVisibleRange.start - bufferSize);
    const stop = Math.min(allRepoIds.length, debouncedVisibleRange.stop + bufferSize);
    return allRepoIds.slice(start, stop);
  }, [allRepoIds, debouncedVisibleRange, bufferSize]);

  // 過濾出尚未載入且未在載入中的 IDs
  const missingIds = useMemo(() => {
    return targetIds.filter((id) => {
      const key = String(id);
      const isLoaded = badgesMap[key] && signalsMap[key];
      const isLoading = loadingIdsRef.current.has(id);
      return !isLoaded && !isLoading;
    });
  }, [targetIds, badgesMap, signalsMap]);

  // 穩定化引用，避免重複載入
  const missingIdsKey = missingIds.join(",");

  // 批次載入缺失的資料
  useEffect(() => {
    if (missingIds.length === 0) return;

    let cancelled = false;
    // 在 effect 開始時捕獲 Set 引用，避免 cleanup 中的 ref 訪問警告
    const loadingSet = loadingIdsRef.current;

    // 標記這些 IDs 為正在載入
    missingIds.forEach((id) => loadingSet.add(id));

    setLoading(true);
    setError(null);

    const chunks = chunkArray(missingIds, MAX_BATCH_SIZE);

    Promise.all([
      Promise.all(chunks.map((c) => getContextBadgesBatch(c))),
      Promise.all(chunks.map((c) => getRepoSignalsBatch(c))),
    ])
      .then(([badgesResults, signalsResults]) => {
        if (!cancelled) {
          const newBadges = Object.assign({}, ...badgesResults);
          const newSignals = Object.assign({}, ...signalsResults);

          // 累積合併（保留已載入的資料）
          setBadgesMap((prev) => ({ ...prev, ...newBadges }));
          setSignalsMap((prev) => ({ ...prev, ...newSignals }));
          setLoading(false);

          // 清除載入標記
          missingIds.forEach((id) => loadingSet.delete(id));
        }
      })
      .catch((err) => {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        // eslint-disable-next-line no-console
        console.error("[useWindowedBatchRepoData] Failed to fetch batch data:", errorObj);

        if (!cancelled) {
          setError(errorObj);
          setLoading(false);

          // 清除載入標記（即使失敗也要清除，否則會永遠不再重試）
          missingIds.forEach((id) => loadingSet.delete(id));
        }
      });

    return () => {
      cancelled = true;
      // cleanup 時也清除載入標記（使用捕獲的 Set 引用）
      missingIds.forEach((id) => loadingSet.delete(id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingIdsKey]);

  // 合併成最終的 dataMap
  const dataMap = useMemo(() => {
    const result: Record<number, BatchRepoData> = {};
    for (const id of allRepoIds) {
      const key = String(id);
      result[id] = {
        badges: badgesMap[key]?.badges ?? EMPTY_BADGES,
        signals: signalsMap[key]?.signals ?? EMPTY_SIGNALS,
      };
    }
    return result;
  }, [allRepoIds, badgesMap, signalsMap]);

  // 包裝 setVisibleRange 以確保穩定引用
  const handleSetVisibleRange = useCallback((range: VisibleRange) => {
    setVisibleRange(range);
  }, []);

  return {
    dataMap,
    loading,
    error,
    setVisibleRange: handleSetVisibleRange,
  };
}
