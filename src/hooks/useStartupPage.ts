/**
 * 啟動時落在哪一頁：有重點→Dashboard，否則回上次的頁面。
 *
 * 先等 digest 再決定，不先畫上次的頁再跳走。發行版的 sidecar 冷啟動要好幾秒，所以
 * 先等它答得出 health（每 500ms 探一次，最多 30 秒），連上之後才給 digest 1 秒。
 * 等待期間每一頁本來也都拿不到資料；sidecar 起不來時 StatusBanner 照樣會顯示。
 * 抓到的結果放進與 useDigest 相同的 query key，Dashboard 不會再打一次。
 * 這裡不送 seen：沒落在 Dashboard 的話使用者根本沒看到。
 */
import { useEffect, useState } from "react";
import { checkHealth, getDigest } from "../api/client";
import type { DigestResponse } from "../api/client";
import { queryClient, queryKeys } from "../lib/react-query";
import type { Page } from "../types/navigation";
import { hasHighlights } from "../utils/digest";

interface StartupDeps {
  fetchDigest: () => Promise<DigestResponse>;
  /** sidecar 答得出 health 就是 true */
  sidecarReachable: () => Promise<boolean>;
}

interface StartupTiming {
  /** sidecar 連上之後給 digest 的時間 */
  answerTimeoutMs?: number;
  /** 等 sidecar 連上的上限 */
  sidecarWaitMs?: number;
  retryDelayMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function resolveStartupPage(
  saved: Page,
  { fetchDigest, sidecarReachable }: StartupDeps,
  { answerTimeoutMs = 1000, sidecarWaitMs = 30_000, retryDelayMs = 500 }: StartupTiming = {}
): Promise<Page> {
  const deadline = Date.now() + sidecarWaitMs;
  while (!(await sidecarReachable())) {
    if (Date.now() + retryDelayMs > deadline) return saved;
    await sleep(retryDelayMs);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), answerTimeoutMs);
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
    void resolveStartupPage(saved, {
      fetchDigest: () =>
        queryClient.fetchQuery({
          queryKey: queryKeys.digest.session(),
          queryFn: ({ signal }) => getDigest(signal),
          staleTime: Infinity,
        }),
      sidecarReachable: () =>
        checkHealth().then(
          () => true,
          () => false
        ),
    }).then((resolved) => {
      if (!cancelled) setPage(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [saved, page]);

  return page;
}
