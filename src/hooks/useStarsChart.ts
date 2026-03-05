/**
 * Star 圖表資料的取得。
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
  timeRange: TimeRange,
  signal: AbortSignal
): Promise<ChartDataPoint[]> {
  if (timeRange === "all") {
    const response = await getStarHistory(repoId, signal);
    return response.history.map((point) => ({
      date: point.date,
      stars: point.stars,
      forks: 0,
    }));
  }
  const response = await getStarsChart(repoId, timeRange, signal);
  return response.data_points;
}

export function useStarsChart(repoId: number) {
  const [state, setState] = useState<ChartState>(initialState);
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(() => {
    setRefetchTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetchChartDataPoints(repoId, timeRange, controller.signal).then(
      (dataPoints) => {
        if (!controller.signal.aborted) {
          setState({ data: dataPoints, loading: false, error: null });
        }
      },
      (err) => {
        if (!controller.signal.aborted) {
          const message = err instanceof Error ? err.message : "圖表載入失敗";
          setState({ data: [], error: message, loading: false });
        }
      }
    );

    return () => controller.abort();
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
