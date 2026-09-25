import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { resolveStartupPage, useStartupPage } from "../useStartupPage";
import { getDigest } from "../../api/client";
import { queryClient } from "../../lib/react-query";

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  getDigest: vi.fn(),
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

describe("resolveStartupPage", () => {
  it("opens the dashboard when there are highlights", async () => {
    expect(await resolveStartupPage("watchlist", async () => withTier("highlight"))).toBe(
      "dashboard"
    );
  });

  it("keeps the last page when there are only other updates", async () => {
    expect(await resolveStartupPage("watchlist", async () => withTier("other"))).toBe("watchlist");
  });

  it("keeps the last page when the digest fails", async () => {
    expect(
      await resolveStartupPage("trends", async () => {
        throw new Error("down");
      })
    ).toBe("trends");
  });

  it("keeps the last page when the digest takes longer than the timeout", async () => {
    vi.useFakeTimers();
    const pending = resolveStartupPage("compare", () => new Promise(() => {}), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe("compare");
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
