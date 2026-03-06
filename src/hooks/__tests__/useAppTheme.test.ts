import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockGetInitialTheme = vi.fn();
const mockSaveTheme = vi.fn();
const mockApplyTheme = vi.fn();

vi.mock("../../theme", () => ({
  getInitialTheme: (...args: unknown[]) => mockGetInitialTheme(...args),
  saveTheme: (...args: unknown[]) => mockSaveTheme(...args),
  applyTheme: (...args: unknown[]) => mockApplyTheme(...args),
}));

import { useAppTheme } from "../useAppTheme";

describe("useAppTheme", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInitialTheme.mockReturnValue("dark");
  });

  it("initializes with theme from getInitialTheme", () => {
    mockGetInitialTheme.mockReturnValue("light");

    const { result } = renderHook(() => useAppTheme());

    expect(result.current.theme).toBe("light");
  });

  it("applies theme on mount", () => {
    const { result } = renderHook(() => useAppTheme());

    expect(result.current.theme).toBe("dark");
    expect(mockApplyTheme).toHaveBeenCalledWith("dark");
  });

  it("setTheme updates state, saves, and applies", () => {
    const { result } = renderHook(() => useAppTheme());

    act(() => {
      result.current.setTheme("light");
    });

    expect(result.current.theme).toBe("light");
    expect(mockSaveTheme).toHaveBeenCalledWith("light");
    expect(mockApplyTheme).toHaveBeenCalledWith("light");
  });

  it("toggleTheme switches dark to light", () => {
    mockGetInitialTheme.mockReturnValue("dark");
    const { result } = renderHook(() => useAppTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe("light");
    expect(mockSaveTheme).toHaveBeenCalledWith("light");
    expect(mockApplyTheme).toHaveBeenCalledWith("light");
  });

  it("toggleTheme switches light to dark", () => {
    mockGetInitialTheme.mockReturnValue("light");
    const { result } = renderHook(() => useAppTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe("dark");
    expect(mockSaveTheme).toHaveBeenCalledWith("dark");
    expect(mockApplyTheme).toHaveBeenCalledWith("dark");
  });

  it("returns stable references via useMemo", () => {
    const { result, rerender } = renderHook(() => useAppTheme());

    const first = result.current;
    rerender();
    const second = result.current;

    // Same object reference when theme hasn't changed
    expect(first.setTheme).toBe(second.setTheme);
    expect(first.toggleTheme).toBe(second.toggleTheme);
  });
});
