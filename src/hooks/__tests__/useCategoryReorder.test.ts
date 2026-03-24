import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCategoryReorder } from "../useCategoryReorder";
import * as client from "../../api/client";
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
});
