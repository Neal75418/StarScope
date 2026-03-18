/**
 * Star 圖表資料的取得。
 * 使用 React Query 管理快取，time range 變更自動觸發重新取得。
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStarsChart, getStarHistory, ChartDataPoint } from "../api/client";
import { queryKeys } from "../lib/react-query";
import { useI18n } from "../i18n";

export type TimeRange = "7d" | "30d" | "90d" | "all";

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
      open_issues: 0,
    }));
  }
  const response = await getStarsChart(repoId, timeRange, signal);
  return response.data_points;
}

export function useStarsChart(repoId: number) {
  const { t } = useI18n();
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");

  const query = useQuery<ChartDataPoint[], Error>({
    queryKey: queryKeys.starsChart.data(repoId, timeRange),
    queryFn: ({ signal }) => fetchChartDataPoints(repoId, timeRange, signal),
  });

  return {
    data: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? query.error.message || t.chart.loadFailed : null,
    timeRange,
    setTimeRange,
    refetch: query.refetch,
  };
}
