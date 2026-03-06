import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDismissedRecs } from "../useDismissedRecs";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe("useDismissedRecs", () => {
  let storageData: Record<string, string>;

  beforeEach(() => {
    storageData = {};
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(
      (key: string) => storageData[key] ?? null
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key: string, value: string) => {
      storageData[key] = value;
    });
  });

  it("starts with empty set when no saved data", () => {
    const { result } = renderHook(() => useDismissedRecs());
    expect(result.current.dismissedIds.size).toBe(0);
  });

  it("loads existing dismissed IDs from localStorage", () => {
    storageData["starscope_dismissed_recs"] = JSON.stringify([1, 2, 3]);

    const { result } = renderHook(() => useDismissedRecs());
    expect(result.current.dismissedIds.size).toBe(3);
    expect(result.current.dismissedIds.has(1)).toBe(true);
    expect(result.current.dismissedIds.has(2)).toBe(true);
    expect(result.current.dismissedIds.has(3)).toBe(true);
  });

  it("handles corrupted localStorage gracefully", () => {
    storageData["starscope_dismissed_recs"] = "not-valid-json";

    const { result } = renderHook(() => useDismissedRecs());
    expect(result.current.dismissedIds.size).toBe(0);
  });

  it("dismisses a repo by adding to set", () => {
    const { result } = renderHook(() => useDismissedRecs());

    act(() => {
      result.current.dismiss(42);
    });

    expect(result.current.dismissedIds.has(42)).toBe(true);
    expect(result.current.dismissedIds.size).toBe(1);
  });

  it("dismisses multiple repos", () => {
    const { result } = renderHook(() => useDismissedRecs());

    act(() => {
      result.current.dismiss(1);
    });
    act(() => {
      result.current.dismiss(2);
    });
    act(() => {
      result.current.dismiss(3);
    });

    expect(result.current.dismissedIds.size).toBe(3);
    expect(result.current.dismissedIds.has(1)).toBe(true);
    expect(result.current.dismissedIds.has(2)).toBe(true);
    expect(result.current.dismissedIds.has(3)).toBe(true);
  });

  it("handles duplicate dismiss gracefully", () => {
    const { result } = renderHook(() => useDismissedRecs());

    act(() => {
      result.current.dismiss(42);
    });
    act(() => {
      result.current.dismiss(42);
    });

    expect(result.current.dismissedIds.size).toBe(1);
  });

  it("persists dismissed IDs to localStorage", () => {
    const { result } = renderHook(() => useDismissedRecs());

    act(() => {
      result.current.dismiss(10);
    });

    const stored = storageData["starscope_dismissed_recs"];
    expect(stored).toBeDefined();
    expect(JSON.parse(stored)).toContain(10);
  });

  it("filters out non-number values from corrupted data", () => {
    storageData["starscope_dismissed_recs"] = JSON.stringify([1, "invalid", null, 2]);

    const { result } = renderHook(() => useDismissedRecs());
    expect(result.current.dismissedIds.size).toBe(2);
    expect(result.current.dismissedIds.has(1)).toBe(true);
    expect(result.current.dismissedIds.has(2)).toBe(true);
  });
});
