import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWatchlistSort } from "../useWatchlistSort";
import { STORAGE_KEYS } from "../../constants/storage";

describe("useWatchlistSort", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns default sort (added_at desc)", () => {
    const { result } = renderHook(() => useWatchlistSort());
    expect(result.current.sortKey).toBe("added_at");
    expect(result.current.sortDirection).toBe("desc");
  });

  it("toggles direction when clicking same key", () => {
    const { result } = renderHook(() => useWatchlistSort());

    act(() => result.current.setSort("added_at"));
    expect(result.current.sortDirection).toBe("asc");

    act(() => result.current.setSort("added_at"));
    expect(result.current.sortDirection).toBe("desc");
  });

  it("switches to new key with default direction (desc for numeric)", () => {
    const { result } = renderHook(() => useWatchlistSort());

    act(() => result.current.setSort("stars"));
    expect(result.current.sortKey).toBe("stars");
    expect(result.current.sortDirection).toBe("desc");
  });

  it("uses asc default for full_name", () => {
    const { result } = renderHook(() => useWatchlistSort());

    act(() => result.current.setSort("full_name"));
    expect(result.current.sortKey).toBe("full_name");
    expect(result.current.sortDirection).toBe("asc");
  });

  it("persists sort to localStorage", () => {
    const { result } = renderHook(() => useWatchlistSort());

    act(() => result.current.setSort("velocity"));

    const raw = localStorage.getItem(STORAGE_KEYS.WATCHLIST_SORT);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw as string);
    expect(stored).toEqual({ key: "velocity", direction: "desc" });
  });

  it("restores sort from localStorage", () => {
    localStorage.setItem(
      STORAGE_KEYS.WATCHLIST_SORT,
      JSON.stringify({ key: "stars", direction: "asc" })
    );

    const { result } = renderHook(() => useWatchlistSort());
    expect(result.current.sortKey).toBe("stars");
    expect(result.current.sortDirection).toBe("asc");
  });

  it("falls back to default on invalid localStorage data", () => {
    localStorage.setItem(STORAGE_KEYS.WATCHLIST_SORT, "invalid-json");

    const { result } = renderHook(() => useWatchlistSort());
    expect(result.current.sortKey).toBe("added_at");
    expect(result.current.sortDirection).toBe("desc");
  });

  it("handles localStorage error gracefully", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    const { result } = renderHook(() => useWatchlistSort());
    expect(result.current.sortKey).toBe("added_at");

    spy.mockRestore();
  });
});
