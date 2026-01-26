import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCategoryExpand } from "../useCategoryExpand";
import type { MouseEvent } from "react";

describe("useCategoryExpand", () => {
  const createMockEvent = () =>
    ({
      stopPropagation: vi.fn(),
    }) as unknown as MouseEvent;

  it("returns initial state with empty expandedIds", () => {
    const { result } = renderHook(() => useCategoryExpand());

    expect(result.current.expandedIds.size).toBe(0);
    expect(result.current.isExpanded(1)).toBe(false);
  });

  it("expands a category when toggled", () => {
    const { result } = renderHook(() => useCategoryExpand());
    const mockEvent = createMockEvent();

    act(() => {
      result.current.toggleExpanded(1, mockEvent);
    });

    expect(result.current.isExpanded(1)).toBe(true);
    expect(mockEvent.stopPropagation).toHaveBeenCalled();
  });

  it("collapses a category when toggled twice", () => {
    const { result } = renderHook(() => useCategoryExpand());

    act(() => {
      result.current.toggleExpanded(1, createMockEvent());
    });

    expect(result.current.isExpanded(1)).toBe(true);

    act(() => {
      result.current.toggleExpanded(1, createMockEvent());
    });

    expect(result.current.isExpanded(1)).toBe(false);
  });

  it("can expand multiple categories", () => {
    const { result } = renderHook(() => useCategoryExpand());

    act(() => {
      result.current.toggleExpanded(1, createMockEvent());
      result.current.toggleExpanded(2, createMockEvent());
      result.current.toggleExpanded(3, createMockEvent());
    });

    expect(result.current.isExpanded(1)).toBe(true);
    expect(result.current.isExpanded(2)).toBe(true);
    expect(result.current.isExpanded(3)).toBe(true);
    expect(result.current.expandedIds.size).toBe(3);
  });

  it("can collapse one category while keeping others expanded", () => {
    const { result } = renderHook(() => useCategoryExpand());

    act(() => {
      result.current.toggleExpanded(1, createMockEvent());
      result.current.toggleExpanded(2, createMockEvent());
    });

    expect(result.current.isExpanded(1)).toBe(true);
    expect(result.current.isExpanded(2)).toBe(true);

    act(() => {
      result.current.toggleExpanded(1, createMockEvent());
    });

    expect(result.current.isExpanded(1)).toBe(false);
    expect(result.current.isExpanded(2)).toBe(true);
  });
});
