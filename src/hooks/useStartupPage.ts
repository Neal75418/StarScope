/**
 * 啟動時落在哪一頁：有重點→Dashboard，否則回上次的頁面。
 *
 * 先等 digest 再決定，不先畫上次的頁再跳走；本機 API 是毫秒級，最多等 1 秒。
 * 抓到的結果放進與 useDigest 相同的 query key，Dashboard 不會再打一次。
 * 這裡不送 seen：沒落在 Dashboard 的話使用者根本沒看到。
 */
import { useEffect, useState } from "react";
import { getDigest } from "../api/client";
import type { DigestResponse } from "../api/client";
import { queryClient, queryKeys } from "../lib/react-query";
import type { Page } from "../types/navigation";
import { hasHighlights } from "../utils/digest";

export async function resolveStartupPage(
  saved: Page,
  fetchDigest: () => Promise<DigestResponse>,
  timeoutMs = 1000
): Promise<Page> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const digest = await Promise.race([fetchDigest(), timeout]);
    return digest && hasHighlights(digest) ? "dashboard" : saved;
  } catch {
    return saved;
  } finally {
    clearTimeout(timer);
  }
}

export function useStartupPage(saved: Page): Page | null {
  const [page, setPage] = useState<Page | null>(saved === "dashboard" ? "dashboard" : null);

  useEffect(() => {
    if (page !== null) return;
    let cancelled = false;
    void resolveStartupPage(saved, () =>
      queryClient.fetchQuery({
        queryKey: queryKeys.digest.session(),
        queryFn: ({ signal }) => getDigest(signal),
        staleTime: Infinity,
      })
    ).then((resolved) => {
      if (!cancelled) setPage(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [saved, page]);

  return page;
}
