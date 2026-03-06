import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSearchHistory } from "../useSearchHistory";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe("useSearchHistory", () => {
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

  it("starts empty when no saved data", () => {
    const { result } = renderHook(() => useSearchHistory());
    expect(result.current.history).toEqual([]);
  });

  it("loads existing history from localStorage", () => {
    storageData["starscope_search_history"] = JSON.stringify(["react", "vue"]);

    const { result } = renderHook(() => useSearchHistory());
    expect(result.current.history).toEqual(["react", "vue"]);
  });

  it("handles corrupted localStorage gracefully", () => {
    storageData["starscope_search_history"] = "not-json{{{";

    const { result } = renderHook(() => useSearchHistory());
    expect(result.current.history).toEqual([]);
  });

  it("adds a new search to history", () => {
    const { result } = renderHook(() => useSearchHistory());

    act(() => {
      result.current.addToHistory("react");
    });

    expect(result.current.history).toEqual(["react"]);
  });

  it("deduplicates by moving existing item to front", () => {
    storageData["starscope_search_history"] = JSON.stringify(["vue", "react", "angular"]);

    const { result } = renderHook(() => useSearchHistory());

    act(() => {
      result.current.addToHistory("react");
    });

    expect(result.current.history[0]).toBe("react");
    expect(result.current.history).toEqual(["react", "vue", "angular"]);
  });

  it("ignores empty or whitespace-only queries", () => {
    const { result } = renderHook(() => useSearchHistory());

    act(() => {
      result.current.addToHistory("");
      result.current.addToHistory("   ");
    });

    expect(result.current.history).toEqual([]);
  });

  it("enforces maximum of 10 items", () => {
    const { result } = renderHook(() => useSearchHistory());

    act(() => {
      for (let i = 0; i < 15; i++) {
        result.current.addToHistory(`query-${i}`);
      }
    });

    expect(result.current.history).toHaveLength(10);
    // Most recent should be first
    expect(result.current.history[0]).toBe("query-14");
  });

  it("removes a specific item from history", () => {
    storageData["starscope_search_history"] = JSON.stringify(["react", "vue", "angular"]);

    const { result } = renderHook(() => useSearchHistory());

    act(() => {
      result.current.removeFromHistory("vue");
    });

    expect(result.current.history).toEqual(["react", "angular"]);
  });

  it("clears all history", () => {
    storageData["starscope_search_history"] = JSON.stringify(["react", "vue"]);

    const { result } = renderHook(() => useSearchHistory());

    act(() => {
      result.current.clearHistory();
    });

    expect(result.current.history).toEqual([]);
  });

  it("persists changes to localStorage", () => {
    const { result } = renderHook(() => useSearchHistory());

    act(() => {
      result.current.addToHistory("persisted-query");
    });

    const stored = storageData["starscope_search_history"];
    expect(stored).toBeDefined();
    expect(JSON.parse(stored)).toContain("persisted-query");
  });

  it("filters out non-string values from corrupted data", () => {
    storageData["starscope_search_history"] = JSON.stringify(["valid", 123, null, "also-valid"]);

    const { result } = renderHook(() => useSearchHistory());
    expect(result.current.history).toEqual(["valid", "also-valid"]);
  });
});
