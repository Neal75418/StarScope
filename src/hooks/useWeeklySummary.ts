/**
 * 取得每週摘要資料的 Hook。
 */

import { useQuery } from "@tanstack/react-query";
import { getWeeklySummary } from "../api/client";
import type { WeeklySummaryResponse } from "../api/types";
import { queryKeys } from "../lib/react-query";

export function useWeeklySummary() {
  return useQuery<WeeklySummaryResponse, Error>({
    queryKey: queryKeys.dashboard.weeklySummary(),
    queryFn: ({ signal }) => getWeeklySummary(signal),
  });
}
