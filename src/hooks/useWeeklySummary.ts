/**
 * 取得週期摘要資料的 Hook。
 */

import { useQuery } from "@tanstack/react-query";
import { getWeeklySummary } from "../api/client";
import type { WeeklySummaryResponse, DashboardTimeRange } from "../api/types";
import { queryKeys } from "../lib/react-query";

export function useWeeklySummary(days: DashboardTimeRange = 7) {
  return useQuery<WeeklySummaryResponse, Error>({
    queryKey: queryKeys.dashboard.weeklySummary(days),
    queryFn: ({ signal }) => getWeeklySummary(days, signal),
  });
}
