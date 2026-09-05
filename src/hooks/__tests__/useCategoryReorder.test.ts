import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCategoryReorder } from "../useCategoryReorder";
import * as client from "../../api/client";
import { logger } from "../../utils/logger";
import type { CategoryTreeNode } from "../../api/client";

vi.mock("../../api/client", () => ({
  updateCategory: vi.fn(),
}));

function makeNode(id: number, name: string, sort_order: number): CategoryTreeNode {
  return {
    id,
    name,
    description: null,
    icon: null,
    color: null,
    sort_order,
    repo_count: 0,
    children: [],
  };
}

describe("useCategoryReorder", () => {
  const mockOnTreeChange = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.updateCategory).mockResolvedValue({} as never);
  });

  it("calls updateCategory for each node with new sort_order", async () => {
    const tree = [makeNode(1, "A", 0), makeNode(2, "B", 1), makeNode(3, "C", 2)];

    const { result } = renderHook(() => useCategoryReorder(tree, mockOnTreeChange));

    act(() => {
      result.current.reorder(3, 1); // Move C before A
    });
    await waitFor(() => {
      expect(mockOnTreeChange).toHaveBeenCalled();
    });

    // After moving C before A: [C, A, B]
    // All three should get updated sort_order
    expect(client.updateCategory).toHaveBeenCalledTimes(3);
  });

  it("does nothing when activeId equals overId", () => {
    const tree = [makeNode(1, "A", 0), makeNode(2, "B", 1)];

    const { result } = renderHook(() => useCategoryReorder(tree, mockOnTreeChange));

    result.current.reorder(1, 1);
    expect(client.updateCategory).not.toHaveBeenCalled();
  });

  it("does nothing when id not found in tree", () => {
    const tree = [makeNode(1, "A", 0)];

    const { result } = renderHook(() => useCategoryReorder(tree, mockOnTreeChange));

    result.current.reorder(1, 999);
    expect(client.updateCategory).not.toHaveBeenCalled();
  });

  it("ignores overlapping reorder calls while one is in flight", async () => {
    // Make updateCategory return a promise that never resolves (to keep isReordering true)
    vi.mocked(client.updateCategory).mockImplementation(() => new Promise(() => {}));

    const tree = [makeNode(1, "A", 0), makeNode(2, "B", 1), makeNode(3, "C", 2)];

    const { result } = renderHook(() => useCategoryReorder(tree, mockOnTreeChange));

    // First reorder — starts in-flight
    act(() => {
      result.current.reorder(2, 1);
    });

    expect(result.current.isReordering).toBe(true);

    // Record how many updateCategory calls the first reorder made
    const firstBatchCalls = vi.mocked(client.updateCategory).mock.calls.length;
    expect(firstBatchCalls).toBeGreaterThan(0);

    // Second reorder while first is in-flight — should be ignored
    act(() => {
      result.current.reorder(3, 1);
    });

    // No additional updateCategory calls should have been made
    expect(client.updateCategory).toHaveBeenCalledTimes(firstBatchCalls);
  });

  it("calls onTreeChange after all updates complete", async () => {
    const tree = [makeNode(1, "A", 0), makeNode(2, "B", 1)];

    const { result } = renderHook(() => useCategoryReorder(tree, mockOnTreeChange));

    act(() => {
      result.current.reorder(2, 1);
    });
    await waitFor(() => {
      expect(mockOnTreeChange).toHaveBeenCalled();
    });

    expect(client.updateCategory).toHaveBeenCalledTimes(2);
  });
  it("still refreshes the tree and unlocks after a failed update", async () => {
    // 單筆失敗會讓 Promise.all reject。真正會傷到使用者的不是那次更新失敗，
    // 而是 isReordering 沒解開——那會讓拖曳從此無聲失效，畫面上看不出原因。
    const failed = new Error("boom");
    // 依 id 決定哪一筆失敗，而不是靠呼叫順序——排序後的更新順序不是 tree 的順序
    vi.mocked(client.updateCategory).mockImplementation((id) =>
      id === 1 ? Promise.reject(failed) : (Promise.resolve({}) as never)
    );
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const tree = [makeNode(1, "A", 0), makeNode(2, "B", 1)];

    const { result } = renderHook(() => useCategoryReorder(tree, mockOnTreeChange));

    act(() => {
      result.current.reorder(2, 1);
    });

    await waitFor(() => {
      expect(mockOnTreeChange).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(result.current.isReordering).toBe(false);
    });

    // 內層 catch 的存在理由：外層只知道「有東西失敗了」，是哪一筆只有這裡知道
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("更新分類 1 排序失敗"), failed);
    errorSpy.mockRestore();
  });

  it("reports the failure to the caller so the UI can show it", async () => {
    // logger 在正式版是 no-op，只寫 log 等於對使用者無聲；失敗必須交給呼叫端顯示
    const failed = new Error("boom");
    vi.mocked(client.updateCategory).mockRejectedValue(failed);
    const onError = vi.fn();
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const tree = [makeNode(1, "A", 0), makeNode(2, "B", 1)];
    const { result } = renderHook(() => useCategoryReorder(tree, mockOnTreeChange, onError));

    act(() => {
      void result.current.reorder(2, 1);
    });

    await waitFor(() => expect(onError).toHaveBeenCalledWith(failed));
    errorSpy.mockRestore();
  });
});
