import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDeleteConfirm } from "../useDeleteConfirm";

describe("useDeleteConfirm", () => {
  it("starts with closed state and null itemId", () => {
    const { result } = renderHook(() => useDeleteConfirm());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.itemId).toBeNull();
  });

  it("opens with correct itemId", () => {
    const { result } = renderHook(() => useDeleteConfirm());
    act(() => {
      result.current.open(42);
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.itemId).toBe(42);
  });

  it("closes and resets itemId", () => {
    const { result } = renderHook(() => useDeleteConfirm());
    act(() => {
      result.current.open(42);
    });
    act(() => {
      result.current.close();
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.itemId).toBeNull();
  });

  it("can reopen with different itemId", () => {
    const { result } = renderHook(() => useDeleteConfirm());
    act(() => {
      result.current.open(1);
    });
    act(() => {
      result.current.close();
    });
    act(() => {
      result.current.open(99);
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.itemId).toBe(99);
  });
});
