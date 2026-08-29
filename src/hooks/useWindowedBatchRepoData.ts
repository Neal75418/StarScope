/**
 * 視窗化批次載入：僅載入可見範圍內的 repo 資料，而非全部。
 * 減少初始載入時間與記憶體使用。
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { ContextBadge, EarlySignal } from "../api/client";
import { getContextBadgesBatch, getRepoSignalsBatch } from "../api/client";
import { logger } from "../utils/logger";

export interface BatchRepoData {
  badges: ContextBadge[];
  signals: EarlySignal[];
}

const MAX_BATCH_SIZE = 50;
const INITIAL_VISIBLE_STOP = 20;
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
  /** 批次是否仍是卡片的資料來源（失敗時交還給卡片自行抓取）。 */
  batchOwnsData: boolean;
}

/**
 * 視窗化批次載入 hook
 *
 * @param allRepoIds - 所有 repo IDs（完整列表）
 * @param options - 配置選項
 * @param options.bufferSize - 視窗上下額外載入的項目數（預設 10）
 * @param options.debounceMs - 資料載入 debounce 延遲（毫秒，預設 150）
 * @returns dataMap, loading, error, setVisibleRange
 */
export function useWindowedBatchRepoData(
  allRepoIds: number[],
  options: UseWindowedBatchRepoDataOptions = {}
): UseWindowedBatchRepoDataResult {
  const { bufferSize = 10, debounceMs = 150 } = options;

  const [visibleRange, setVisibleRange] = useState<VisibleRange>({
    start: 0,
    stop: INITIAL_VISIBLE_STOP,
  });
  const [debouncedVisibleRange, setDebouncedVisibleRange] = useState<VisibleRange>({
    start: 0,
    stop: INITIAL_VISIBLE_STOP,
  });
  const [badgesMap, setBadgesMap] = useState<Record<string, { badges: ContextBadge[] }>>({});
  const [signalsMap, setSignalsMap] = useState<Record<string, { signals: EarlySignal[] }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const loadingIdsRef = useRef<Set<number>>(new Set());
  const inFlightCountRef = useRef(0);
  const controllersRef = useRef<Set<AbortController>>(new Set());
  // 世代計數：error 同時是 batchOwnsData（=false 時整頁掉回每卡自抓的 N+1 模式），
  // 只允許「最新一批」的失敗寫入，否則被取代批次的暫時性失敗會蓋掉當前視窗的健康狀態
  const generationRef = useRef(0);

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

    const controller = new AbortController();
    controllersRef.current.add(controller);
    const generation = ++generationRef.current;
    const loadingSet = loadingIdsRef.current;
    const ownedIds = new Set(missingIds);

    // 標記這些 IDs 為正在載入
    missingIds.forEach((id) => loadingSet.add(id));
    inFlightCountRef.current += 1;

    setLoading(true);
    setError(null);

    const chunks = chunkArray(missingIds, MAX_BATCH_SIZE);

    // 不論成敗都要歸還載入標記，否則這些 id 永遠不會再被抓
    const settle = () => {
      inFlightCountRef.current -= 1;
      controllersRef.current.delete(controller);
      ownedIds.forEach((id) => loadingSet.delete(id));
    };

    Promise.all([
      Promise.all(chunks.map((c) => getContextBadgesBatch(c, controller.signal))),
      Promise.all(chunks.map((c) => getRepoSignalsBatch(c, controller.signal))),
    ])
      .then(([badgesResults, signalsResults]) => {
        settle();
        if (controller.signal.aborted) return; // 只有 unmount 會 abort

        const newBadges = Object.assign({}, ...badgesResults);
        const newSignals = Object.assign({}, ...signalsResults);

        setBadgesMap((prev) => ({ ...prev, ...newBadges }));
        setSignalsMap((prev) => ({ ...prev, ...newSignals }));
        if (inFlightCountRef.current === 0) setLoading(false);
      })
      .catch((err) => {
        settle();
        if (controller.signal.aborted) return;
        const errorObj = err instanceof Error ? err : new Error(String(err));
        logger.error("[useWindowedBatchRepoData] 批次資料抓取失敗:", errorObj);
        if (generation === generationRef.current) setError(errorObj);
        if (inFlightCountRef.current === 0) setLoading(false);
      });

    // 刻意沒有 cleanup abort：被新視窗「取代」的批次讓它跑完落入快取即可。
    // 若在這裡 abort，loadingSet 清掉後不會有任何 re-render 重算 missingIds，
    // 這些 id 會卡在「未載入也不再載入」直到下次互動（死鎖）。abort 只在 unmount 做。
    // 用 missingIdsKey（逗號串接字串）代替 missingIds 陣列，避免引用變化觸發重複請求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingIdsKey]);

  // unmount 時中止所有仍在途的批次
  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      controllers.forEach((c) => c.abort());
    };
  }, []);

  // 合併成最終的 dataMap（增量更新：只替換真正有變化的 entry，穩定 reference）
  // 輸出所有已載入的資料（不侷限於 allRepoIds），讓 SummaryPanel 等全域消費者
  // 即使在分類 / 搜尋過濾時仍能讀取先前載入的 repo signals
  const prevDataMapRef = useRef<Record<number, BatchRepoData>>({});

  const dataMap = useMemo(() => {
    const prev = prevDataMapRef.current;
    let changed = false;
    const result: Record<number, BatchRepoData> = {};

    // 收集所有已載入資料的 keys
    const loadedKeys = new Set<string>();
    for (const key of Object.keys(badgesMap)) loadedKeys.add(key);
    for (const key of Object.keys(signalsMap)) loadedKeys.add(key);

    for (const key of loadedKeys) {
      const id = Number(key);
      const newBadges = badgesMap[key]?.badges ?? EMPTY_BADGES;
      const newSignals = signalsMap[key]?.signals ?? EMPTY_SIGNALS;
      const existing = prev[id];

      if (existing && existing.badges === newBadges && existing.signals === newSignals) {
        result[id] = existing;
      } else {
        result[id] = { badges: newBadges, signals: newSignals };
        changed = true;
      }
    }

    if (!changed && Object.keys(prev).length === loadedKeys.size) {
      return prev;
    }

    prevDataMapRef.current = result;
    return result;
  }, [badgesMap, signalsMap]);

  // 包裝 setVisibleRange 以確保穩定引用
  const handleSetVisibleRange = useCallback((range: VisibleRange) => {
    setVisibleRange(range);
  }, []);

  return {
    dataMap,
    loading,
    error,
    setVisibleRange: handleSetVisibleRange,
    // 批次是否仍是這些卡片的資料來源。卡片據此決定「要不要自己去抓」——
    // 批次成功時永遠不需要（後端對沒有資料的 repo 也會回空陣列，
    // 所以到貨後 preloaded 必為 defined）；只有批次失敗才放行個別請求當退路。
    batchOwnsData: error === null,
  };
}
