import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useViewMode } from "../useViewMode";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe("useViewMode", () => {
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

  it("defaults to list mode when no saved data", () => {
    const { result } = renderHook(() => useViewMode());
    expect(result.current.viewMode).toBe("list");
  });

  it("loads saved mode from localStorage", () => {
    storageData["starscope_view_mode"] = "grid";
    const { result } = renderHook(() => useViewMode());
    expect(result.current.viewMode).toBe("grid");
  });

  it("falls back to list when localStorage has invalid value", () => {
    storageData["starscope_view_mode"] = "invalid";
    const { result } = renderHook(() => useViewMode());
    expect(result.current.viewMode).toBe("list");
  });

  it("switches to grid mode and persists", () => {
    const { result } = renderHook(() => useViewMode());

    act(() => {
      result.current.setViewMode("grid");
    });

    expect(result.current.viewMode).toBe("grid");
    expect(storageData["starscope_view_mode"]).toBe("grid");
  });

  it("switches back to list mode and persists", () => {
    storageData["starscope_view_mode"] = "grid";
    const { result } = renderHook(() => useViewMode());

    act(() => {
      result.current.setViewMode("list");
    });

    expect(result.current.viewMode).toBe("list");
    expect(storageData["starscope_view_mode"]).toBe("list");
  });
});
