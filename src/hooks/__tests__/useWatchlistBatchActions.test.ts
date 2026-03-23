import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWatchlistBatchActions } from "../useWatchlistBatchActions";
import * as client from "../../api/client";
import type { WatchlistActions } from "../../contexts/watchlistReducer";

vi.mock("../../api/client", () => ({
  addRepoToCategory: vi.fn(),
  removeRepo: vi.fn(),
  fetchRepo: vi.fn(),
}));

interface BatchResult {
  success: number;
  failed: number;
  total: number;
  failedIds?: number[];
}

describe("useWatchlistBatchActions", () => {
  const mockRefreshAll = vi.fn().mockResolvedValue(undefined);
  const mockActions = {
    refreshAll: mockRefreshAll,
  } as unknown as WatchlistActions;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("batchAddToCategory adds each repo to category", async () => {
    vi.mocked(client.addRepoToCategory).mockResolvedValue({ status: "ok", message: "" });
    const selectedIds = new Set([1, 2, 3]);

    const { result } = renderHook(() => useWatchlistBatchActions(selectedIds, mockActions));

    let batchResult: BatchResult | undefined;
    await act(async () => {
      batchResult = await result.current.batchAddToCategory(5);
    });

    expect(client.addRepoToCategory).toHaveBeenCalledTimes(3);
    expect(client.addRepoToCategory).toHaveBeenCalledWith(5, 1);
    expect(client.addRepoToCategory).toHaveBeenCalledWith(5, 2);
    expect(client.addRepoToCategory).toHaveBeenCalledWith(5, 3);
    expect(batchResult).toBeDefined();
    expect(batchResult?.success).toBe(3);
    expect(batchResult?.failed).toBe(0);
    expect(batchResult?.failedIds).toEqual([]);
    expect(mockRefreshAll).toHaveBeenCalled();
  });

  it("batchAddToCategory counts failures and returns failedIds", async () => {
    vi.mocked(client.addRepoToCategory)
      .mockResolvedValueOnce({ status: "ok", message: "" })
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce({ status: "ok", message: "" });

    const selectedIds = new Set([1, 2, 3]);
    const { result } = renderHook(() => useWatchlistBatchActions(selectedIds, mockActions));

    let batchResult: BatchResult | undefined;
    await act(async () => {
      batchResult = await result.current.batchAddToCategory(5);
    });

    expect(batchResult?.success).toBe(2);
    expect(batchResult?.failed).toBe(1);
    expect(batchResult?.failedIds).toEqual([2]);
  });

  it("batchRefresh fetches each repo", async () => {
    vi.mocked(client.fetchRepo).mockResolvedValue({} as client.RepoWithSignals);
    const selectedIds = new Set([10, 20]);

    const { result } = renderHook(() => useWatchlistBatchActions(selectedIds, mockActions));

    let batchResult: BatchResult | undefined;
    await act(async () => {
      batchResult = await result.current.batchRefresh();
    });

    expect(client.fetchRepo).toHaveBeenCalledTimes(2);
    expect(batchResult?.success).toBe(2);
    expect(mockRefreshAll).toHaveBeenCalled();
  });

  it("batchRemove removes each repo", async () => {
    vi.mocked(client.removeRepo).mockResolvedValue(undefined);
    const selectedIds = new Set([1, 2]);

    const { result } = renderHook(() => useWatchlistBatchActions(selectedIds, mockActions));

    let batchResult: BatchResult | undefined;
    await act(async () => {
      batchResult = await result.current.batchRemove();
    });

    expect(client.removeRepo).toHaveBeenCalledTimes(2);
    expect(batchResult?.success).toBe(2);
    expect(mockRefreshAll).toHaveBeenCalled();
  });

  it("returns zero result for empty selection", async () => {
    const selectedIds = new Set<number>();
    const { result } = renderHook(() => useWatchlistBatchActions(selectedIds, mockActions));

    let batchResult: BatchResult | undefined;
    await act(async () => {
      batchResult = await result.current.batchRemove();
    });

    expect(batchResult?.total).toBe(0);
    expect(client.removeRepo).not.toHaveBeenCalled();
  });
});
