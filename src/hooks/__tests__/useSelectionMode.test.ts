import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSelectionMode } from "../useSelectionMode";

describe("useSelectionMode", () => {
  it("starts inactive with no selections", () => {
    const { result } = renderHook(() => useSelectionMode());
    expect(result.current.isActive).toBe(false);
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.selectedCount).toBe(0);
  });

  it("enters selection mode and clears selections", () => {
    const { result } = renderHook(() => useSelectionMode());

    act(() => {
      result.current.enter();
    });

    expect(result.current.isActive).toBe(true);
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("exits selection mode and clears selections", () => {
    const { result } = renderHook(() => useSelectionMode());

    act(() => {
      result.current.enter();
      result.current.toggleSelection(1);
    });

    expect(result.current.selectedCount).toBe(1);

    act(() => {
      result.current.exit();
    });

    expect(result.current.isActive).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it("toggles selection on and off", () => {
    const { result } = renderHook(() => useSelectionMode());

    act(() => {
      result.current.enter();
      result.current.toggleSelection(42);
    });

    expect(result.current.selectedIds.has(42)).toBe(true);
    expect(result.current.selectedCount).toBe(1);

    act(() => {
      result.current.toggleSelection(42);
    });

    expect(result.current.selectedIds.has(42)).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it("selects multiple items independently", () => {
    const { result } = renderHook(() => useSelectionMode());

    act(() => {
      result.current.enter();
      result.current.toggleSelection(1);
      result.current.toggleSelection(2);
      result.current.toggleSelection(3);
    });

    expect(result.current.selectedCount).toBe(3);
    expect(result.current.selectedIds.has(1)).toBe(true);
    expect(result.current.selectedIds.has(2)).toBe(true);
    expect(result.current.selectedIds.has(3)).toBe(true);
  });

  it("selectAll replaces current selection", () => {
    const { result } = renderHook(() => useSelectionMode());

    act(() => {
      result.current.enter();
      result.current.toggleSelection(99);
    });

    expect(result.current.selectedCount).toBe(1);

    act(() => {
      result.current.selectAll([10, 20, 30]);
    });

    expect(result.current.selectedCount).toBe(3);
    expect(result.current.selectedIds.has(99)).toBe(false);
    expect(result.current.selectedIds.has(10)).toBe(true);
    expect(result.current.selectedIds.has(20)).toBe(true);
    expect(result.current.selectedIds.has(30)).toBe(true);
  });

  it("clearSelection clears all without exiting mode", () => {
    const { result } = renderHook(() => useSelectionMode());

    act(() => {
      result.current.enter();
      result.current.toggleSelection(1);
      result.current.toggleSelection(2);
    });

    expect(result.current.selectedCount).toBe(2);

    act(() => {
      result.current.clearSelection();
    });

    expect(result.current.selectedCount).toBe(0);
    expect(result.current.isActive).toBe(true);
  });

  it("enter clears any previous selections", () => {
    const { result } = renderHook(() => useSelectionMode());

    act(() => {
      result.current.enter();
      result.current.toggleSelection(1);
      result.current.toggleSelection(2);
    });

    expect(result.current.selectedCount).toBe(2);

    act(() => {
      result.current.enter();
    });

    expect(result.current.isActive).toBe(true);
    expect(result.current.selectedCount).toBe(0);
  });
});
