/**
 * useSmartInterval / useVisibleInterval 的測試。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSmartInterval, useVisibleInterval } from "../useSmartInterval";

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

describe("useVisibleInterval", () => {
  const originalHidden = document.hidden;

  /** 設定 document.hidden 並派發 visibilitychange（jsdom 不會自己派發）。 */
  function setHidden(hidden: boolean) {
    Object.defineProperty(document, "hidden", {
      value: hidden,
      writable: true,
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { value: false, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "hidden", {
      value: originalHidden,
      writable: true,
      configurable: true,
    });
  });

  it("runs the callback on the interval while visible", () => {
    const cb = vi.fn();
    renderHook(() => useVisibleInterval(cb, 1000));

    // 掛載時不立即執行——呼叫端自己決定要不要先算一次
    expect(cb).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(3000));
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("pauses while hidden and does not accumulate missed ticks", () => {
    const cb = vi.fn();
    renderHook(() => useVisibleInterval(cb, 1000));

    setHidden(true);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(cb).not.toHaveBeenCalled();
  });

  it("fires once immediately on becoming visible, before resuming ticks", () => {
    const cb = vi.fn();
    renderHook(() => useVisibleInterval(cb, 1000));

    setHidden(true);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(cb).not.toHaveBeenCalled();

    // 補跑：隱藏期間顯示的值已過期，不能等到下一次 tick 才更新
    setHidden(false);
    expect(cb).toHaveBeenCalledTimes(1);

    act(() => void vi.advanceTimersByTime(1000));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("does not start a timer when delayMs is false", () => {
    const cb = vi.fn();
    renderHook(() => useVisibleInterval(cb, false));

    act(() => void vi.advanceTimersByTime(10_000));
    expect(cb).not.toHaveBeenCalled();
  });

  it("does not restart the timer when only the callback reference changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useVisibleInterval(cb, 1000), {
      initialProps: { cb: first },
    });

    act(() => void vi.advanceTimersByTime(900));
    rerender({ cb: second });

    // 計時器沒有重啟，所以再過 100ms 就到期，而且用的是新的 callback
    act(() => void vi.advanceTimersByTime(100));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops the timer and removes the listener on unmount", () => {
    const cb = vi.fn();
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useVisibleInterval(cb, 1000));

    unmount();
    act(() => void vi.advanceTimersByTime(5000));

    expect(cb).not.toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    removeSpy.mockRestore();
  });
});
