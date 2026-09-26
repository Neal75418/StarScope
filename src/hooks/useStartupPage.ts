/**
 * 啟動時落在哪一頁：有重點→Dashboard，否則回上次的頁面。
 *
 * 先等 digest 再決定，不先畫上次的頁再跳走。發行版的 sidecar 冷啟動要好幾秒，所以
 * 先等它連上（每 500ms 看一次 sidecarConnection 的狀態，最多等到啟動時間結束），連上之後才給 digest 1 秒。
 * 等待期間每一頁本來也都拿不到資料；sidecar 起不來時 StatusBanner 照樣會顯示。
 * 抓到的結果放進與 useDigest 相同的 query key，Dashboard 不會再打一次。
 * 這裡不送 seen：沒落在 Dashboard 的話使用者根本沒看到。
 */
import { useEffect, useState } from "react";
import { getDigest } from "../api/client";
import { getSidecarPhase, STARTUP_GRACE_MS } from "../api/sidecarConnection";
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
  // 等 sidecar 的上限與啟動時間一致：比它短的話，第 30–45 秒才連上時就不看 digest 了
  {
    answerTimeoutMs = 1000,
    sidecarWaitMs = STARTUP_GRACE_MS,
    retryDelayMs = 500,
  }: StartupTiming = {}
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
      // 跟 app 其他地方看同一個連線狀態（AppStatusProvider 啟動的監測），不另外打 health
      sidecarReachable: async () => getSidecarPhase() === "up",
    }).then((resolved) => {
      if (!cancelled) setPage(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [saved, page]);

  return page;
}
