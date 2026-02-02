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

async function fetchChartDataPoints(
  repoId: number,
  timeRange: TimeRange
): Promise<ChartDataPoint[]> {
  if (timeRange === "all") {
    const response = await getStarHistory(repoId);
    return response.history.map((point) => ({
      date: point.date,
      stars: point.stars,
      forks: 0,
    }));
  }
  const response = await getStarsChart(repoId, timeRange);
  return response.data_points;
}

export function useStarsChart(repoId: number) {
  const [state, setState] = useState<ChartState>(initialState);
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  // Tracks the latest fetch to discard stale responses
  const fetchIdRef = useRef(0);

  const refetch = useCallback(() => {
    setRefetchTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const currentFetchId = ++fetchIdRef.current;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetchChartDataPoints(repoId, timeRange).then(
      (dataPoints) => {
        if (currentFetchId === fetchIdRef.current) {
          setState({ data: dataPoints, loading: false, error: null });
        }
      },
      (err) => {
        if (currentFetchId === fetchIdRef.current) {
          const message = err instanceof Error ? err.message : "Failed to load chart";
          setState({ data: [], error: message, loading: false });
        }
      }
    );
  }, [repoId, timeRange, refetchTrigger]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    timeRange,
    setTimeRange,
    refetch,
  };
}
