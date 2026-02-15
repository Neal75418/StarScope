import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWindowedBatchRepoData } from "../useWindowedBatchRepoData";

// Mock API
const mockBadgesResponse = {
  "1": {
    repo_id: 1,
    badges: [
      { type: "hn" as const, label: "HN", url: "https://hn.com", score: 100, is_recent: true },
    ],
  },
  "2": { repo_id: 2, badges: [] },
};
const mockSignalsResponse = {
  "1": {
    signals: [
      {
        id: 100,
        repo_id: 1,
        signal_type: "rising_star",
        severity: "medium",
        description: "test",
        detected_at: "2024-01-01",
        acknowledged: false,
      },
    ],
  },
  "2": { signals: [] },
};

vi.mock("../../api/client", () => ({
  getContextBadgesBatch: vi.fn(() => Promise.resolve(mockBadgesResponse)),
  getRepoSignalsBatch: vi.fn(() => Promise.resolve(mockSignalsResponse)),
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useWindowedBatchRepoData", () => {
  it("returns empty dataMap when no repo IDs provided", () => {
    const { result } = renderHook(() => useWindowedBatchRepoData([]));

    expect(result.current.dataMap).toEqual({});
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("fetches data for visible repo IDs", async () => {
    const { getContextBadgesBatch, getRepoSignalsBatch } = await import("../../api/client");

    const { result } = renderHook(() => useWindowedBatchRepoData([1, 2], { debounceMs: 0 }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(getContextBadgesBatch).toHaveBeenCalled();
      expect(getRepoSignalsBatch).toHaveBeenCalled();
    });

    expect(result.current.dataMap[1].badges).toHaveLength(1);
    expect(result.current.dataMap[1].signals).toHaveLength(1);
    expect(result.current.dataMap[2].badges).toHaveLength(0);
  });

  it("provides setVisibleRange callback", () => {
    const { result } = renderHook(() => useWindowedBatchRepoData([1, 2, 3]));

    expect(typeof result.current.setVisibleRange).toBe("function");

    act(() => {
      result.current.setVisibleRange({ start: 1, stop: 3 });
    });
  });

  it("returns empty badges and signals for IDs not in API response", async () => {
    const { result } = renderHook(() => useWindowedBatchRepoData([1, 2, 999], { debounceMs: 0 }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // ID 999 not in mock response — should return empty arrays
    expect(result.current.dataMap[999].badges).toEqual([]);
    expect(result.current.dataMap[999].signals).toEqual([]);
  });

  it("handles API error gracefully", async () => {
    const { getContextBadgesBatch } = await import("../../api/client");
    // 用 mockImplementation 確保所有呼叫都 reject（包含 debounce 後的延遲呼叫）
    vi.mocked(getContextBadgesBatch).mockImplementation(() =>
      Promise.reject(new Error("Network error"))
    );

    const { result } = renderHook(() => useWindowedBatchRepoData([1], { debounceMs: 0 }));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error?.message).toBe("Network error");
    expect(result.current.loading).toBe(false);

    // 恢復預設 mock，避免影響後續測試
    vi.mocked(getContextBadgesBatch).mockImplementation(() => Promise.resolve(mockBadgesResponse));
  });

  it("does not re-fetch already loaded IDs", async () => {
    const { getContextBadgesBatch, getRepoSignalsBatch } = await import("../../api/client");

    const { result, rerender } = renderHook(
      ({ ids }: { ids: number[] }) => useWindowedBatchRepoData(ids, { debounceMs: 0 }),
      { initialProps: { ids: [1, 2] } }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const callCountBadges = vi.mocked(getContextBadgesBatch).mock.calls.length;
    const callCountSignals = vi.mocked(getRepoSignalsBatch).mock.calls.length;

    // Re-render with same IDs — should not trigger new fetch
    rerender({ ids: [1, 2] });

    // Wait a tick to ensure no new calls
    await new Promise((r) => setTimeout(r, 50));

    expect(vi.mocked(getContextBadgesBatch).mock.calls.length).toBe(callCountBadges);
    expect(vi.mocked(getRepoSignalsBatch).mock.calls.length).toBe(callCountSignals);
  });
});
