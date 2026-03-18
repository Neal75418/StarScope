/**
 * 批次取得趨勢 repo 的 Early Signal，並衍生出 breakout repo Set。
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRepoSignalsBatch } from "../api/client";
import { queryKeys } from "../lib/react-query";
import type { EarlySignal } from "../api/types";

/**
 * @param repoIds - Repo ID 陣列。呼叫端應以 `useMemo` 穩定化此陣列，
 *   避免每次 render 產生新 reference 導致不必要的 re-fetch。
 */
export function useTrendEarlySignals(repoIds: number[]) {
  const stableKey = useMemo(() => [...repoIds].sort((a, b) => a - b), [repoIds]);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.signals.batch(stableKey),
    queryFn: () => getRepoSignalsBatch(stableKey),
    enabled: stableKey.length > 0,
    staleTime: 2 * 60 * 1000, // 2 min — 訊號不常更新，避免過度 fetch
  });

  const { signalsByRepoId, reposWithBreakouts } = useMemo(() => {
    if (!data) {
      return {
        signalsByRepoId: {} as Record<number, EarlySignal[]>,
        reposWithBreakouts: new Set<number>(),
      };
    }
    const byId: Record<number, EarlySignal[]> = {};
    const withBreakouts = new Set<number>();
    for (const [key, response] of Object.entries(data)) {
      if (response.signals.length === 0) continue;
      const id = Number(key);
      byId[id] = response.signals;
      if (response.signals.some((s) => !s.acknowledged)) {
        withBreakouts.add(id);
      }
    }
    return { signalsByRepoId: byId, reposWithBreakouts: withBreakouts };
  }, [data]);

  return { signalsByRepoId, loading: isLoading, reposWithBreakouts };
}
