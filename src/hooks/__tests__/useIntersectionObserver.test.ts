import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { useIntersectionObserver } from "../useIntersectionObserver";

type IntersectionCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;

/** Test harness that attaches sentinelRef to a real DOM element. */
function TestHarness({
  onIntersect,
  enabled = true,
}: {
  onIntersect: () => void;
  enabled?: boolean;
}) {
  const { sentinelRef, isSupported } = useIntersectionObserver({ onIntersect, enabled });
  return createElement("div", {
    ref: sentinelRef,
    "data-testid": "sentinel",
    "data-supported": String(isSupported),
  });
}

describe("useIntersectionObserver", () => {
  let mockObserve: ReturnType<typeof vi.fn>;
  let mockDisconnect: ReturnType<typeof vi.fn>;
  let capturedCallback: IntersectionCallback | null;
  const OriginalIntersectionObserver = globalThis.IntersectionObserver;

  beforeEach(() => {
    mockObserve = vi.fn();
    mockDisconnect = vi.fn();
    capturedCallback = null;

    // 使用 function（非 arrow）才能當 constructor
    globalThis.IntersectionObserver = function (callback: IntersectionCallback) {
      capturedCallback = callback;
      return {
        observe: mockObserve,
        disconnect: mockDisconnect,
        unobserve: vi.fn(),
        root: null,
        rootMargin: "",
        thresholds: [],
        takeRecords: vi.fn().mockReturnValue([]),
      };
    } as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    globalThis.IntersectionObserver = OriginalIntersectionObserver;
  });

  it("returns sentinelRef and isSupported=true when IntersectionObserver exists", () => {
    const onIntersect = vi.fn();
    const { result } = renderHook(() => useIntersectionObserver({ onIntersect, enabled: true }));

    expect(result.current.sentinelRef).toBeDefined();
    expect(result.current.isSupported).toBe(true);
  });

  it("does not create observer when enabled is false", () => {
    const onIntersect = vi.fn();
    render(createElement(TestHarness, { onIntersect, enabled: false }));

    expect(mockObserve).not.toHaveBeenCalled();
  });

  it("calls onIntersect when entry is intersecting", () => {
    const onIntersect = vi.fn();
    render(createElement(TestHarness, { onIntersect }));

    expect(capturedCallback).not.toBeNull();
    const cb = capturedCallback as IntersectionCallback;
    act(() => {
      cb([{ isIntersecting: true }]);
    });
    expect(onIntersect).toHaveBeenCalledTimes(1);
  });

  it("does not call onIntersect when entry is not intersecting", () => {
    const onIntersect = vi.fn();
    render(createElement(TestHarness, { onIntersect }));

    expect(capturedCallback).not.toBeNull();
    const cb = capturedCallback as IntersectionCallback;
    act(() => {
      cb([{ isIntersecting: false }]);
    });
    expect(onIntersect).not.toHaveBeenCalled();
  });

  it("reports isSupported false when IntersectionObserver is unavailable", () => {
    // @ts-expect-error intentionally setting to undefined for testing
    globalThis.IntersectionObserver = undefined;

    const onIntersect = vi.fn();
    const { result } = renderHook(() => useIntersectionObserver({ onIntersect, enabled: true }));

    expect(result.current.isSupported).toBe(false);
    expect(mockObserve).not.toHaveBeenCalled();
  });

  it("uses onIntersect from latest render (callback ref pattern)", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    const { rerender } = render(createElement(TestHarness, { onIntersect: cb1 }));

    rerender(createElement(TestHarness, { onIntersect: cb2 }));

    expect(capturedCallback).not.toBeNull();
    const cb = capturedCallback as IntersectionCallback;
    act(() => {
      cb([{ isIntersecting: true }]);
    });
    expect(cb2).toHaveBeenCalled();
    expect(cb1).not.toHaveBeenCalled();
  });
});
