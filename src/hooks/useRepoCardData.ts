/**
 * Hook for fetching repo card data (badges and signals).
 * Uses useAsyncFetch for reduced complexity.
 * Simplified version without tags.
 */

import { useState, useCallback } from "react";
import {
  ContextBadge,
  EarlySignal,
  getContextBadges,
  getRepoSignals,
  fetchRepoContext,
} from "../api/client";
import { useAsyncFetch } from "./useAsyncFetch";

interface UseRepoCardDataResult {
  badges: ContextBadge[];
  badgesLoading: boolean;
  signals: EarlySignal[];
  signalsLoading: boolean;
  activeSignalCount: number;
  refreshContext: () => Promise<void>;
  isRefreshingContext: boolean;
}

export function useRepoCardData(repoId: number): UseRepoCardDataResult {
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshingContext, setIsRefreshingContext] = useState(false);

  const { data: badges, loading: badgesLoading } = useAsyncFetch(
    () => getContextBadges(repoId),
    (response) => response.badges,
    [] as ContextBadge[],
    [repoId, refreshKey],
    "badges"
  );

  const { data: signals, loading: signalsLoading } = useAsyncFetch(
    () => getRepoSignals(repoId),
    (response) => response.signals,
    [] as EarlySignal[],
    [repoId],
    "signals"
  );

  // Count active (unacknowledged) signals
  const activeSignalCount = signals.filter((s) => !s.acknowledged).length;

  const refreshContext = useCallback(async () => {
    setIsRefreshingContext(true);
    try {
      await fetchRepoContext(repoId);
      // Trigger badges reload after context fetch
      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      console.error("Failed to refresh context:", err);
    } finally {
      setIsRefreshingContext(false);
    }
  }, [repoId]);

  return {
    badges,
    badgesLoading,
    signals,
    signalsLoading,
    activeSignalCount,
    refreshContext,
    isRefreshingContext,
  };
}
