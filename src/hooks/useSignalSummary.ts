/**
 * 活躍訊號的摘要（總數、依類型、有訊號的 repo 數）。
 *
 * 儀表板與追蹤清單共用同一個 query key：兩頁的「有訊號」數字必須一致，
 * 而且從儀表板切過來時直接命中快取。
 */
import { useQuery } from "@tanstack/react-query";
import { getSignalSummary } from "../api/client";
import { queryKeys } from "../lib/react-query";

export function useSignalSummary() {
  return useQuery({
    queryKey: queryKeys.signals.summary(),
    queryFn: () => getSignalSummary(),
  });
}
