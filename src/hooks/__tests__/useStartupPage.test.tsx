import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { resolveStartupPage, useStartupPage } from "../useStartupPage";
import { getDigest } from "../../api/client";
import { queryClient } from "../../lib/react-query";

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  getDigest: vi.fn(),
  checkHealth: vi.fn(async () => ({ status: "ok" })),
}));
import type { DigestResponse } from "../../api/client";

const repo = { id: 1, full_name: "o/r", url: "https://github.com/o/r" };
const withTier = (tier: "highlight" | "other"): DigestResponse => ({
  items: [
    {
      key: "release:1",
      tier,
      kind: "release",
      repo,
      occurred_at: "2026-09-25T00:00:00+00:00",
      url: null,
      title: "v1",
      tags: [],
    },
  ],
  other_total: tier === "other" ? 1 : 0,
  cursor: { context_signal_id: 1, early_signal_id: 0, triggered_alert_id: 0 },
  last_seen_at: null,
  releases_checked: true,
});

const up = async () => true;

describe("resolveStartupPage", () => {
  it("opens the dashboard when there are highlights", async () => {
    const page = await resolveStartupPage("watchlist", {
      fetchDigest: async () => withTier("highlight"),
      sidecarReachable: up,
    });
    expect(page).toBe("dashboard");
  });

  it("keeps the last page when there are only other updates", async () => {
    const page = await resolveStartupPage("watchlist", {
      fetchDigest: async () => withTier("other"),
      sidecarReachable: up,
    });
    expect(page).toBe("watchlist");
  });

  it("keeps the last page when the digest fails", async () => {
    const page = await resolveStartupPage("trends", {
      fetchDigest: async () => {
        throw new Error("down");
      },
      sidecarReachable: up,
    });
    expect(page).toBe("trends");
  });

  it("keeps the last page when the digest takes longer than the timeout", async () => {
    vi.useFakeTimers();
    const pending = resolveStartupPage(
      "compare",
      { fetchDigest: () => new Promise(() => {}), sidecarReachable: up },
      { answerTimeoutMs: 1000 }
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe("compare");
    vi.useRealTimers();
  });

  it("waits for a sidecar that is still starting before giving the digest its second", async () => {
    // 發行版的 sidecar 冷啟動要好幾秒：一開始就計 1 秒的話永遠等不到，功能安靜地失效
    vi.useFakeTimers();
    let probes = 0;
    const fetchDigest = vi.fn(async () => withTier("highlight"));
    const pending = resolveStartupPage(
      "watchlist",
      { fetchDigest, sidecarReachable: async () => ++probes > 3 },
      { retryDelayMs: 500, sidecarWaitMs: 30_000 }
    );
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toBe("dashboard");
    expect(fetchDigest).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("gives up on a sidecar that never comes up and keeps the last page", async () => {
    vi.useFakeTimers();
    const fetchDigest = vi.fn(async () => withTier("highlight"));
    const pending = resolveStartupPage(
      "settings",
      { fetchDigest, sidecarReachable: async () => false },
      { retryDelayMs: 500, sidecarWaitMs: 5_000 }
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toBe("settings");
    expect(fetchDigest).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("useStartupPage", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(getDigest).mockReset();
  });

  it("saved dashboard needs no decision and does not wait for the digest", () => {
    const { result } = renderHook(() => useStartupPage("dashboard"));
    expect(result.current).toBe("dashboard");
    expect(getDigest).not.toHaveBeenCalled();
  });

  it("another saved page waits (null) and then follows the digest", async () => {
    vi.mocked(getDigest).mockResolvedValue(withTier("highlight"));

    const { result } = renderHook(() => useStartupPage("watchlist"));

    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe("dashboard"));
  });

  it("leaves the fetched batch in the cache for the dashboard to reuse", async () => {
    vi.mocked(getDigest).mockResolvedValue(withTier("other"));

    const { result } = renderHook(() => useStartupPage("trends"));

    await waitFor(() => expect(result.current).toBe("trends"));
    expect(queryClient.getQueryData(["digest", "session"])).toEqual(withTier("other"));
  });
});
