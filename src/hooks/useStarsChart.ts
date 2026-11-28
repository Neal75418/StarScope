/**
 * Star 圖表資料的取得。
 * 使用 React Query 管理快取，time range 變更自動觸發重新取得。
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChartDataPoint } from "../api/client";
import { getStarsChart, getStarHistory } from "../api/client";
import { loadStatus, queryKeys } from "../lib/react-query";

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
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");

  const query = useQuery<ChartDataPoint[], Error>({
    queryKey: queryKeys.starsChart.data(repoId, timeRange),
    queryFn: ({ signal }) => fetchChartDataPoints(repoId, timeRange, signal),
  });

  return {
    data: query.data ?? [],
    // 讀取狀態看 loadStatus，不拿 isLoading 當閘門：還沒有資料時重試，isLoading 又是 true，
    // 主體換成讀取中、重試鈕消失。錯誤的原字不上畫面，說明由元件決定
    load: loadStatus(query),
    timeRange,
    setTimeRange,
    refetch: query.refetch,
  };
}
