import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../../api/client", () => ({
  getContextBadges: vi.fn(),
  getRepoSignals: vi.fn(),
  fetchRepoContext: vi.fn(),
}));

vi.mock("../../utils/requestCache", () => ({
  cachedRequest: vi.fn((_key: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { getContextBadges, getRepoSignals, fetchRepoContext } from "../../api/client";
import { useRepoCardData } from "../useRepoCardData";

const mockGetBadges = vi.mocked(getContextBadges);
const mockGetSignals = vi.mocked(getRepoSignals);
const mockFetchContext = vi.mocked(fetchRepoContext);

describe("useRepoCardData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches badges and signals for a repo", async () => {
    const badges = [{ type: "trending", label: "Trending" }];
    const signals = [{ id: 1, signal_type: "spike", acknowledged: false }];

    mockGetBadges.mockResolvedValue({ badges } as never);
    mockGetSignals.mockResolvedValue({ signals } as never);

    const { result } = renderHook(() => useRepoCardData(42));

    await waitFor(() => {
      expect(result.current.badgesLoading).toBe(false);
    });

    expect(result.current.badges).toEqual(badges);
    expect(result.current.signals).toEqual(signals);
    expect(result.current.activeSignalCount).toBe(1);
  });

  it("uses preloaded data instead of fetched data", async () => {
    const preloadedBadges = [{ type: "star", label: "Star" }];
    const preloadedSignals = [{ id: 1, signal_type: "growth", acknowledged: true }];

    // Even though useAsyncFetch runs on mount, the returned data uses preloaded values
    mockGetBadges.mockResolvedValue({ badges: [{ type: "other", label: "Other" }] } as never);
    mockGetSignals.mockResolvedValue({ signals: [] } as never);

    const { result } = renderHook(() =>
      useRepoCardData(42, { badges: preloadedBadges as never, signals: preloadedSignals as never })
    );

    // Should use preloaded data, not fetched data
    expect(result.current.badges).toEqual(preloadedBadges);
    expect(result.current.signals).toEqual(preloadedSignals);
    expect(result.current.badgesLoading).toBe(false);
    expect(result.current.signalsLoading).toBe(false);
  });

  it("counts active (unacknowledged) signals", async () => {
    mockGetBadges.mockResolvedValue({ badges: [] } as never);
    mockGetSignals.mockResolvedValue({
      signals: [
        { id: 1, signal_type: "spike", acknowledged: false },
        { id: 2, signal_type: "growth", acknowledged: true },
        { id: 3, signal_type: "trending", acknowledged: false },
      ],
    } as never);

    const { result } = renderHook(() => useRepoCardData(42));

    await waitFor(() => {
      expect(result.current.signalsLoading).toBe(false);
    });

    expect(result.current.activeSignalCount).toBe(2);
  });

  it("refreshContext triggers fetchRepoContext then refetches badges and signals", async () => {
    mockGetBadges.mockResolvedValue({ badges: [] } as never);
    mockGetSignals.mockResolvedValue({ signals: [] } as never);
    mockFetchContext.mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useRepoCardData(42));

    await waitFor(() => {
      expect(result.current.badgesLoading).toBe(false);
    });

    const newBadges = [{ type: "hot", label: "Hot" }];
    mockGetBadges.mockResolvedValue({ badges: newBadges } as never);

    await act(async () => {
      await result.current.refreshContext();
    });

    expect(mockFetchContext).toHaveBeenCalledWith(42);
    expect(result.current.isRefreshingContext).toBe(false);

    // After refresh, badges should be re-fetched
    await waitFor(() => {
      expect(result.current.badges).toEqual(newBadges);
    });
  });

  it("handles refreshContext failure gracefully", async () => {
    mockGetBadges.mockResolvedValue({ badges: [] } as never);
    mockGetSignals.mockResolvedValue({ signals: [] } as never);
    mockFetchContext.mockRejectedValue(new Error("Context fetch failed"));

    const { result } = renderHook(() => useRepoCardData(42));

    await waitFor(() => {
      expect(result.current.badgesLoading).toBe(false);
    });

    await act(async () => {
      await result.current.refreshContext();
    });

    // Should not throw, just log error
    expect(result.current.isRefreshingContext).toBe(false);
  });
});
