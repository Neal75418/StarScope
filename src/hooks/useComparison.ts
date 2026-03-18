/**
 * 取得對比圖表資料的 Hook。
 */

import { useQuery } from "@tanstack/react-query";
import { getComparisonChart } from "../api/client";
import type { ComparisonChartResponse, ComparisonTimeRange } from "../api/types";
import { queryKeys } from "../lib/react-query";

export function useComparison(
  repoIds: number[],
  timeRange: ComparisonTimeRange = "30d",
  normalize: boolean = false
) {
  const { data, isLoading, error, refetch } = useQuery<ComparisonChartResponse, Error>({
    queryKey: queryKeys.comparison.chart(repoIds, timeRange, normalize),
    queryFn: () => getComparisonChart(repoIds, timeRange, normalize),
    enabled: repoIds.length >= 2,
  });
  return { data, isLoading, error, refetch };
}
