/**
 * Hook for fetching star chart data.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { getStarsChart, getStarHistory, ChartDataPoint } from "../api/client";

export type TimeRange = "7d" | "30d" | "90d" | "all";

interface ChartState {
  data: ChartDataPoint[];
  loading: boolean;
  error: string | null;
}

const initialState: ChartState = {
  data: [],
  loading: true,
  error: null,
};

export function useStarsChart(repoId: number) {
  const [state, setState] = useState<ChartState>(initialState);
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const isMounted = useRef(true);
  // Prevent duplicate fetches from StrictMode
  const isFetchingRef = useRef(false);

  const safeSetState = useCallback((update: Partial<ChartState>) => {
    if (isMounted.current) {
      setState((prev) => ({ ...prev, ...update }));
    }
  }, []);

  const refetch = useCallback(() => {
    setRefetchTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    isMounted.current = true;

    const fetchData = async () => {
      safeSetState({ loading: true, error: null });
      try {
        if (timeRange === "all") {
          // Use getStarHistory API which returns complete star history from stargazers
          // This endpoint fetches all stargazer timestamps and reconstructs cumulative star count
          const response = await getStarHistory(repoId);
          // Convert StarHistoryPoint[] to ChartDataPoint[]
          // Note: Star history API only tracks stars, not forks (fork history unavailable via GitHub API)
          const dataPoints: ChartDataPoint[] = response.history.map((point) => ({
            date: point.date,
            stars: point.stars,
            forks: 0,
          }));
          safeSetState({ data: dataPoints, loading: false });
        } else {
          const response = await getStarsChart(repoId, timeRange);
          safeSetState({ data: response.data_points, loading: false });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load chart";
        safeSetState({ error: message, loading: false });
      } finally {
        isFetchingRef.current = false;
      }
    };

    void fetchData();

    return () => {
      isMounted.current = false;
    };
  }, [repoId, timeRange, refetchTrigger, safeSetState]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    timeRange,
    setTimeRange,
    refetch,
  };
}
