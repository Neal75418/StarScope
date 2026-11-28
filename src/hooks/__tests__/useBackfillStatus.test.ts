import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { useBackfillStatus } from "../useBackfillStatus";
import * as apiClient from "../../api/client";
import { createTestQueryClient } from "../../lib/react-query";
import { BACKFILL_OFFLINE_RECHECK_MS } from "../../constants/polling";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getBackfillStatus: vi.fn(),
  };
});

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe("useBackfillStatus", () => {
  const mockStatus: apiClient.BackfillStatus = {
    repo_id: 1,
    repo_name: "test/repo",
    can_backfill: true,
    current_stars: 100,
    max_stars_allowed: 5000,
    has_backfilled_data: false,
    backfilled_days: 0,
    message: "Ready to backfill",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getBackfillStatus).mockReset();
  });

  it("returns initial loading state", () => {
    vi.mocked(apiClient.getBackfillStatus).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useBackfillStatus(1, false), {
      wrapper: createWrapper(),
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.status).toBe(null);
    expect(result.current.error).toBe(null);
    expect(result.current.isOffline).toBe(false);
  });

  it("loads status successfully", async () => {
    vi.mocked(apiClient.getBackfillStatus).mockResolvedValue(mockStatus);

    const { result } = renderHook(() => useBackfillStatus(1, false), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.status).toEqual(mockStatus);
    expect(result.current.error).toBe(null);
    expect(result.current.lastUpdated).toBeInstanceOf(Date);
  });

  it("does not load when exceedsStarLimit is true", async () => {
    vi.mocked(apiClient.getBackfillStatus).mockResolvedValue(mockStatus);

    const { result } = renderHook(() => useBackfillStatus(1, true), {
      wrapper: createWrapper(),
    });

    // Query is disabled — should never fire
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(apiClient.getBackfillStatus).not.toHaveBeenCalled();
  });

  it("handles 404 error by setting status to null", async () => {
    vi.mocked(apiClient.getBackfillStatus).mockRejectedValue(
      new apiClient.ApiError(404, "Not found")
    );

    const { result } = renderHook(() => useBackfillStatus(1, false), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.status).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it("handles network error with offline state", async () => {
    // apiCall 把 fetch 失敗包成 ApiError(0, "Network error: …")（WebKit 的訊息是 Load failed）
    vi.mocked(apiClient.getBackfillStatus).mockRejectedValue(
      new apiClient.ApiError(0, "Network error: Load failed")
    );

    const { result } = renderHook(() => useBackfillStatus(1, false), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isOffline).toBe(true);
    expect(result.current.error).toBe("Offline - showing cached data");
  });

  it("handles other errors", async () => {
    vi.mocked(apiClient.getBackfillStatus).mockRejectedValue(
      new apiClient.ApiError(400, "Bad request")
    );

    const { result } = renderHook(() => useBackfillStatus(1, false), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // 讀的是狀態、不是在回填：交給 LoadError 說讀不到並給重試，不放進 error（error 是回填動作的說明）
    expect(result.current.statusLoad.failed).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it.each([
    ["a server error", new apiClient.ApiError(500, "Internal server error")],
    ["a timeout", new apiClient.ApiError(0, "Request timed out")],
  ])("does not call %s being offline", async (_label, failure) => {
    vi.mocked(apiClient.getBackfillStatus).mockRejectedValue(failure);

    const { result } = renderHook(() => useBackfillStatus(1, false), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isOffline).toBe(false);
    expect(result.current.statusLoad.failed).toBe(true);
  });

  it.each([
    ["a server error", new apiClient.ApiError(500, "Internal server error")],
    ["a timeout", new apiClient.ApiError(0, "Request timed out")],
  ])("leaves the offline state when a later reading gets %s", async (_label, failure) => {
    // 延遲 reject：立刻 reject 的話 isFetching 的 true→false 會被 React Query 的通知合併掉，effect 不跑
    const later = <T>(settle: () => T) =>
      new Promise<T>((resolve, reject) =>
        setTimeout(() => {
          try {
            resolve(settle());
          } catch (e) {
            reject(e);
          }
        }, 10)
      );
    vi.mocked(apiClient.getBackfillStatus)
      .mockImplementationOnce(() =>
        later(() => {
          throw new apiClient.ApiError(0, "Network error: Load failed");
        })
      )
      .mockImplementationOnce(() =>
        later(() => {
          throw failure;
        })
      );
    const { result } = renderHook(() => useBackfillStatus(1, false), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isOffline).toBe(true));

    await act(async () => {
      await result.current.loadStatus();
    });

    await waitFor(() => expect(result.current.isOffline).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.statusLoad.failed).toBe(true);
    // 讀不到不算更新過：「上次更新」不能變成剛剛
    expect(result.current.lastUpdated).toBeNull();
  });

  it("reads again when the data engine comes back, instead of staying offline", async () => {
    // 離線時回傳上次的資料當成讀到了：正式版 staleTime 5 分鐘內它算新鮮，重新連上時 React Query
    // 只重讀過期的查詢，回填區塊就一直停在「離線」、回填鈕停用
    const client = createTestQueryClient();
    client.setDefaultOptions({
      queries: { ...client.getDefaultOptions().queries, staleTime: 5 * 60 * 1000 },
    });
    // 延遲才結算：立刻結算的話 isFetching 的 true→false 會被 React Query 的通知合併掉，同步離線狀態的 effect 不跑
    const later = <T>(settle: () => T) =>
      new Promise<T>((resolve, reject) =>
        setTimeout(() => {
          try {
            resolve(settle());
          } catch (e) {
            reject(e);
          }
        }, 10)
      );
    vi.mocked(apiClient.getBackfillStatus)
      .mockImplementationOnce(() =>
        later(() => {
          throw new apiClient.ApiError(0, "Network error: Load failed");
        })
      )
      .mockImplementationOnce(() => later(() => mockStatus));
    const { result } = renderHook(() => useBackfillStatus(1, false), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children),
    });
    await waitFor(() => expect(result.current.isOffline).toBe(true));

    try {
      act(() => onlineManager.setOnline(false));
      act(() => onlineManager.setOnline(true));

      await waitFor(() => expect(result.current.isOffline).toBe(false));
      expect(result.current.status).toEqual(mockStatus);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("keeps checking while it shows offline, even when the connection never dropped", async () => {
    // 回填狀態的端點連不上、但健康檢查一直答得出來（onlineManager 沒離線過）：等不到「重新連上」，要自己再看
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const client = createTestQueryClient();
      client.setDefaultOptions({
        queries: { ...client.getDefaultOptions().queries, staleTime: 5 * 60 * 1000 },
      });
      vi.mocked(apiClient.getBackfillStatus)
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) =>
              setTimeout(() => reject(new apiClient.ApiError(0, "Network error: Load failed")), 10)
            )
        )
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(mockStatus), 10))
        );
      const { result } = renderHook(() => useBackfillStatus(1, false), {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(QueryClientProvider, { client }, children),
      });
      await waitFor(() => expect(result.current.isOffline).toBe(true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(BACKFILL_OFFLINE_RECHECK_MS + 50);
      });

      await waitFor(() => expect(result.current.isOffline).toBe(false));
      expect(result.current.status).toEqual(mockStatus);

      // 恢復之後就不再輪詢：每張打開的圖都每 10 秒讀一次的話是白打
      const calls = vi.mocked(apiClient.getBackfillStatus).mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BACKFILL_OFFLINE_RECHECK_MS * 3);
      });
      expect(apiClient.getBackfillStatus).toHaveBeenCalledTimes(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads again when the chart is reopened after it showed offline", async () => {
    // 收起期間重新連上（沒有觀察者，重新連上不讀）、5 分鐘內再打開：還算新鮮的話不讀，離線那次留下的空狀態一直留著
    const client = createTestQueryClient();
    client.setDefaultOptions({
      queries: {
        ...client.getDefaultOptions().queries,
        staleTime: 5 * 60 * 1000,
        gcTime: Infinity,
      },
    });
    vi.mocked(apiClient.getBackfillStatus)
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new apiClient.ApiError(0, "Network error: Load failed")), 10)
          )
      )
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockStatus), 10))
      );
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const first = renderHook(() => useBackfillStatus(1, false), { wrapper });
    await waitFor(() => expect(first.result.current.isOffline).toBe(true));
    first.unmount();

    const again = renderHook(() => useBackfillStatus(1, false), { wrapper });

    await waitFor(() => expect(again.result.current.status).toEqual(mockStatus));
    expect(apiClient.getBackfillStatus).toHaveBeenCalledTimes(2);
  });

  it("loadStatus triggers a re-fetch", async () => {
    vi.mocked(apiClient.getBackfillStatus).mockResolvedValue(mockStatus);

    const { result } = renderHook(() => useBackfillStatus(1, false), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const callsBefore = vi.mocked(apiClient.getBackfillStatus).mock.calls.length;

    await act(async () => {
      await result.current.loadStatus();
    });

    await waitFor(() => {
      expect(vi.mocked(apiClient.getBackfillStatus).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
