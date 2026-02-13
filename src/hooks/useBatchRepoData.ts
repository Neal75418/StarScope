/**
 * 批次載入多個 repo 的 badges 與 signals，減少 N 次請求為 2 次。
 */

import { useState, useEffect, useMemo } from "react";
import {
  ContextBadge,
  EarlySignal,
  getContextBadgesBatch,
  getRepoSignalsBatch,
} from "../api/client";
import { logger } from "../utils/logger";

export interface BatchRepoData {
  badges: ContextBadge[];
  signals: EarlySignal[];
}

const MAX_BATCH_SIZE = 50;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

interface UseBatchRepoDataResult {
  dataMap: Record<number, BatchRepoData>;
  loading: boolean;
  error: Error | null;
}

export function useBatchRepoData(repoIds: number[]): UseBatchRepoDataResult {
  const [badgesMap, setBadgesMap] = useState<Record<string, { badges: ContextBadge[] }>>({});
  const [signalsMap, setSignalsMap] = useState<Record<string, { signals: EarlySignal[] }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // 穩定化 repoIds 參考，避免每次 render 觸發重新載入
  const idsKey = repoIds.join(",");

  useEffect(() => {
    if (repoIds.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null); // 重置錯誤狀態

    const chunks = chunkArray(repoIds, MAX_BATCH_SIZE);

    Promise.all([
      Promise.all(chunks.map((c) => getContextBadgesBatch(c))),
      Promise.all(chunks.map((c) => getRepoSignalsBatch(c))),
    ])
      .then(([badgesResults, signalsResults]) => {
        if (!cancelled) {
          const mergedBadges = Object.assign({}, ...badgesResults);
          const mergedSignals = Object.assign({}, ...signalsResults);
          setBadgesMap(mergedBadges);
          setSignalsMap(mergedSignals);
          setLoading(false);
        }
      })
      .catch((err) => {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        logger.error("[useBatchRepoData] Failed to fetch batch data:", errorObj);

        if (!cancelled) {
          setError(errorObj);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // 用 idsKey（JSON 字串）代替 repoIds 陣列作為 dep，避免陣列引用變化觸發重新請求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const dataMap = useMemo(() => {
    const result: Record<number, BatchRepoData> = {};
    for (const id of repoIds) {
      const key = String(id);
      result[id] = {
        badges: badgesMap[key]?.badges ?? [],
        signals: signalsMap[key]?.signals ?? [],
      };
    }
    return result;
    // 用 idsKey 代替 repoIds 陣列引用，避免不必要的重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, badgesMap, signalsMap]);

  return { dataMap, loading, error };
}
