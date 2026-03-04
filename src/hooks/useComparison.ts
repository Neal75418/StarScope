/**
 * Hook for fetching comparison chart data.
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
  return useQuery<ComparisonChartResponse, Error>({
    queryKey: queryKeys.comparison.chart(repoIds, timeRange, normalize),
    queryFn: () => getComparisonChart(repoIds, timeRange, normalize),
    enabled: repoIds.length >= 2,
  });
}
