/**
 * Hook for fetching trending repos data.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { API_ENDPOINT } from "../config";
import { useI18n } from "../i18n";

export type SortOption = "velocity" | "stars_delta_7d" | "stars_delta_30d" | "acceleration";

export interface TrendingRepo {
  id: number;
  owner: string;
  name: string;
  full_name: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number | null;
  stars_delta_7d: number | null;
  stars_delta_30d: number | null;
  velocity: number | null;
  acceleration: number | null;
  trend: number | null;
  rank: number;
}

interface TrendsResponse {
  repos: TrendingRepo[];
  total: number;
  sort_by: string;
}

export function useTrends() {
  const { t } = useI18n();
  const [trends, setTrends] = useState<TrendingRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("velocity");

  // Prevent duplicate fetches from StrictMode
  const isFetchingRef = useRef(false);

  const fetchTrends = useCallback(
    async (sort: SortOption) => {
      // Skip if already fetching (prevents StrictMode double-fetch)
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`${API_ENDPOINT}/trends/?sort_by=${sort}&limit=50`);
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const data: TrendsResponse = await res.json();
        setTrends(data.repos);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.trends.loadingError);
      } finally {
        setLoading(false);
        isFetchingRef.current = false;
      }
    },
    [t.trends.loadingError]
  );

  useEffect(() => {
    void fetchTrends(sortBy);
  }, [sortBy, fetchTrends]);

  const retry = useCallback(() => {
    void fetchTrends(sortBy);
  }, [fetchTrends, sortBy]);

  return {
    trends,
    loading,
    error,
    sortBy,
    setSortBy,
    retry,
  };
}
