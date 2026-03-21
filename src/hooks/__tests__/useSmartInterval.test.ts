/**
 * useSmartInterval 和 useSmartIntervalCallback 的測試。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSmartInterval, useSmartIntervalCallback } from "../useSmartInterval";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock useOnlineStatus
let mockOnline = true;
vi.mock("../useOnlineStatus", () => ({
  useOnlineStatus: () => mockOnline,
}));

describe("useSmartInterval", () => {
  const originalHidden = document.hidden;

  beforeEach(() => {
    mockOnline = true;
    Object.defineProperty(document, "hidden", { value: false, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(document, "hidden", {
      value: originalHidden,
      writable: true,
      configurable: true,
    });
  });

  it("returns interval when online and visible", () => {
    const { result } = renderHook(() => useSmartInterval(60_000));
    expect(result.current()).toBe(60_000);
  });

  it("returns false when document is hidden", () => {
    Object.defineProperty(document, "hidden", { value: true, writable: true, configurable: true });
    const { result } = renderHook(() => useSmartInterval(60_000));
    expect(result.current()).toBe(false);
  });

  it("returns false when offline", () => {
    mockOnline = false;
    const { result } = renderHook(() => useSmartInterval(60_000));
    expect(result.current()).toBe(false);
  });

  it("returns stable function reference", () => {
    const { result, rerender } = renderHook(() => useSmartInterval(60_000));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe("useSmartIntervalCallback", () => {
  const originalHidden = document.hidden;

  beforeEach(() => {
    mockOnline = true;
    Object.defineProperty(document, "hidden", { value: false, writable: true, configurable: true });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "hidden", {
      value: originalHidden,
      writable: true,
      configurable: true,
    });
  });

  it("calls callback at interval when online and visible", () => {
    const callback = vi.fn();
    renderHook(() => useSmartIntervalCallback(callback, 1000));

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("skips callback when document is hidden", () => {
    Object.defineProperty(document, "hidden", { value: true, writable: true, configurable: true });
    const callback = vi.fn();
    renderHook(() => useSmartIntervalCallback(callback, 1000));

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(callback).toHaveBeenCalledTimes(0);
  });

  it("skips callback when offline", () => {
    mockOnline = false;
    const callback = vi.fn();
    renderHook(() => useSmartIntervalCallback(callback, 1000));

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(callback).toHaveBeenCalledTimes(0);
  });

  it("does nothing when callback is null", () => {
    renderHook(() => useSmartIntervalCallback(null, 1000));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
  });

  it("cleans up interval on unmount", () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => useSmartIntervalCallback(callback, 1000));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
