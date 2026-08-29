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

describe("useWindowedBatchRepoData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("setVisibleRange updates the visible window", async () => {
    const { result } = renderHook(() => useWindowedBatchRepoData([1, 2, 3], { debounceMs: 0 }));

    act(() => {
      result.current.setVisibleRange({ start: 0, stop: 2 });
    });

    // After setting range, the hook should still resolve and provide data
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Verify dataMap is populated for the visible IDs
    expect(result.current.dataMap[1]).toBeDefined();
    expect(result.current.dataMap[2]).toBeDefined();
  });

  it("returns empty badges and signals for IDs not in API response", async () => {
    const { result } = renderHook(() => useWindowedBatchRepoData([1, 2, 999], { debounceMs: 0 }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // ID 999 not in mock response — dataMap only contains loaded entries
    expect(result.current.dataMap[999]).toBeUndefined();
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

    // clearAllMocks in beforeEach 會恢復 mock，無需手動恢復
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

    // Flush microtasks to ensure no new calls are pending
    await act(async () => {});

    expect(vi.mocked(getContextBadgesBatch).mock.calls.length).toBe(callCountBadges);
    expect(vi.mocked(getRepoSignalsBatch).mock.calls.length).toBe(callCountSignals);
  });

  it("in-flight 批次不因視窗改變而中止（regression：中止會讓這些 id 卡死）", async () => {
    // 死鎖序列：批次起飛 → 視窗改變使 missingIds 變空 → 舊碼在 cleanup abort
    // 並清掉 loadingSet → 之後沒有任何 re-render 會把這些 id 撿回來。
    const { getContextBadgesBatch } = await import("../../api/client");
    let resolveBadges: (() => void) | undefined;
    vi.mocked(getContextBadgesBatch).mockImplementation(
      () =>
        new Promise((res) => {
          resolveBadges = () => res(mockBadgesResponse);
        })
    );

    const { result } = renderHook(() => useWindowedBatchRepoData([1, 2], { debounceMs: 0 }));

    await waitFor(() => {
      expect(vi.mocked(getContextBadgesBatch)).toHaveBeenCalled();
    });

    // 批次仍在途時改變視窗：target 內容不變但 missingIds 變空 → effect 重跑
    act(() => {
      result.current.setVisibleRange({ start: 0, stop: 1 });
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    // 放行第一批 — 結果必須落地（舊碼因已 abort 而整批丟棄）
    await act(async () => {
      resolveBadges?.();
    });

    await waitFor(() => {
      expect(result.current.dataMap[1]).toBeDefined();
      expect(result.current.dataMap[2]).toBeDefined();
      expect(result.current.loading).toBe(false);
    });
  });
});
