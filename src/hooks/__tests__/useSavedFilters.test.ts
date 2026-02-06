import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSavedFilters } from "../useSavedFilters";

describe("useSavedFilters", () => {
  let storageData: Record<string, string>;

  beforeEach(() => {
    storageData = {};
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(
      (key: string) => storageData[key] ?? null
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key: string, value: string) => {
      storageData[key] = value;
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation((key: string) => {
      delete storageData[key];
    });
  });

  it("starts empty when no saved data", () => {
    const { result } = renderHook(() => useSavedFilters());

    expect(result.current.savedFilters).toEqual([]);
    expect(result.current.hasFilters).toBe(false);
  });

  it("loads existing filters from localStorage", () => {
    const existing = [
      {
        id: "filter-1",
        name: "My Filter",
        createdAt: "2024-01-01T00:00:00Z",
        query: "react",
        filters: {},
      },
    ];
    storageData["starscope_saved_filters"] = JSON.stringify(existing);

    const { result } = renderHook(() => useSavedFilters());

    expect(result.current.savedFilters).toHaveLength(1);
    expect(result.current.savedFilters[0].name).toBe("My Filter");
  });

  it("handles invalid localStorage data gracefully", () => {
    storageData["starscope_saved_filters"] = "not-json";

    const { result } = renderHook(() => useSavedFilters());
    expect(result.current.savedFilters).toEqual([]);
  });

  it("saves a new filter", () => {
    const { result } = renderHook(() => useSavedFilters());

    let saved: ReturnType<typeof result.current.saveFilter> | undefined;
    act(() => {
      saved = result.current.saveFilter("Test Filter", "react", undefined, {});
    });

    expect(saved?.name).toBe("Test Filter");
    expect(result.current.savedFilters).toHaveLength(1);
    expect(result.current.hasFilters).toBe(true);
  });

  it("uses default name when empty name provided", () => {
    const { result } = renderHook(() => useSavedFilters());

    let saved: ReturnType<typeof result.current.saveFilter> | undefined;
    act(() => {
      saved = result.current.saveFilter("", "react", undefined, {});
    });

    expect(saved?.name).toMatch(/篩選條件/);
  });

  it("deletes a filter", () => {
    const existing = [
      {
        id: "filter-1",
        name: "Filter 1",
        createdAt: "2024-01-01T00:00:00Z",
        query: "react",
        filters: {},
      },
      {
        id: "filter-2",
        name: "Filter 2",
        createdAt: "2024-01-02T00:00:00Z",
        query: "vue",
        filters: {},
      },
    ];
    storageData["starscope_saved_filters"] = JSON.stringify(existing);

    const { result } = renderHook(() => useSavedFilters());
    expect(result.current.savedFilters).toHaveLength(2);

    act(() => {
      result.current.deleteFilter("filter-1");
    });

    expect(result.current.savedFilters).toHaveLength(1);
    expect(result.current.savedFilters[0].id).toBe("filter-2");
  });

  it("renames a filter", () => {
    const existing = [
      {
        id: "filter-1",
        name: "Old Name",
        createdAt: "2024-01-01T00:00:00Z",
        query: "react",
        filters: {},
      },
    ];
    storageData["starscope_saved_filters"] = JSON.stringify(existing);

    const { result } = renderHook(() => useSavedFilters());

    act(() => {
      result.current.renameFilter("filter-1", "New Name");
    });

    expect(result.current.savedFilters[0].name).toBe("New Name");
  });

  it("keeps original name when renaming with empty string", () => {
    const existing = [
      {
        id: "filter-1",
        name: "Original",
        createdAt: "2024-01-01T00:00:00Z",
        query: "react",
        filters: {},
      },
    ];
    storageData["starscope_saved_filters"] = JSON.stringify(existing);

    const { result } = renderHook(() => useSavedFilters());

    act(() => {
      result.current.renameFilter("filter-1", "  ");
    });

    expect(result.current.savedFilters[0].name).toBe("Original");
  });

  it("clears all filters", () => {
    const existing = [
      {
        id: "filter-1",
        name: "Filter 1",
        createdAt: "2024-01-01T00:00:00Z",
        query: "react",
        filters: {},
      },
      {
        id: "filter-2",
        name: "Filter 2",
        createdAt: "2024-01-02T00:00:00Z",
        query: "vue",
        filters: {},
      },
    ];
    storageData["starscope_saved_filters"] = JSON.stringify(existing);

    const { result } = renderHook(() => useSavedFilters());

    act(() => {
      result.current.clearAllFilters();
    });

    expect(result.current.savedFilters).toEqual([]);
    expect(result.current.hasFilters).toBe(false);
  });

  it("enforces MAX_SAVED_FILTERS limit (20)", () => {
    const { result } = renderHook(() => useSavedFilters());

    act(() => {
      for (let i = 0; i < 25; i++) {
        result.current.saveFilter(`Filter ${i}`, `query-${i}`, undefined, {});
      }
    });

    expect(result.current.savedFilters.length).toBeLessThanOrEqual(20);
  });

  it("persists changes to localStorage", () => {
    const { result } = renderHook(() => useSavedFilters());

    act(() => {
      result.current.saveFilter("Persisted", "react", undefined, {});
    });

    const stored = storageData["starscope_saved_filters"];
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("Persisted");
  });
});
