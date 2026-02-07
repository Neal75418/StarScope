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

export interface BatchRepoData {
  badges: ContextBadge[];
  signals: EarlySignal[];
}

interface UseBatchRepoDataResult {
  dataMap: Record<number, BatchRepoData>;
  loading: boolean;
}

export function useBatchRepoData(repoIds: number[]): UseBatchRepoDataResult {
  const [badgesMap, setBadgesMap] = useState<Record<string, { badges: ContextBadge[] }>>({});
  const [signalsMap, setSignalsMap] = useState<Record<string, { signals: EarlySignal[] }>>({});
  const [loading, setLoading] = useState(false);

  // 穩定化 repoIds 參考，避免每次 render 觸發重新載入
  const idsKey = repoIds.join(",");

  useEffect(() => {
    if (repoIds.length === 0) return;
    let cancelled = false;
    setLoading(true);

    Promise.all([getContextBadgesBatch(repoIds), getRepoSignalsBatch(repoIds)])
      .then(([badges, signals]) => {
        if (!cancelled) {
          setBadgesMap(badges);
          setSignalsMap(signals);
          setLoading(false);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[useBatchRepoData] Failed to fetch batch data:", err);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, badgesMap, signalsMap]);

  return { dataMap, loading };
}
