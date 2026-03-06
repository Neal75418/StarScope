import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAsyncFetch } from "../useAsyncFetch";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../utils/requestCache", () => ({
  cachedRequest: vi.fn(),
}));

import { cachedRequest } from "../../utils/requestCache";
const mockCachedRequest = vi.mocked(cachedRequest);

describe("useAsyncFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches data and updates state", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ items: [1, 2, 3] });
    const extractData = (res: { items: number[] }) => res.items;

    const { result } = renderHook(() =>
      useAsyncFetch(fetchFn, extractData, [] as number[], [], "TestContext")
    );

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual([1, 2, 3]);
    expect(result.current.error).toBeNull();
  });

  it("sets error state on fetch failure", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("Network error"));
    const extractData = (res: unknown) => res;

    const { result } = renderHook(() => useAsyncFetch(fetchFn, extractData, null, [], "LoadItems"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Network error");
    expect(result.current.data).toBeNull();
  });

  it("uses fallback error message for non-Error exceptions", async () => {
    const fetchFn = vi.fn().mockRejectedValue("string error");
    const extractData = (res: unknown) => res;

    const { result } = renderHook(() => useAsyncFetch(fetchFn, extractData, null, [], "LoadItems"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("LoadItems failed");
  });

  it("uses cachedRequest when cacheKey is provided", async () => {
    const mockData = { items: ["cached"] };
    mockCachedRequest.mockResolvedValue(mockData);
    const fetchFn = vi.fn();
    const extractData = (res: { items: string[] }) => res.items;

    const { result } = renderHook(() =>
      useAsyncFetch(fetchFn, extractData, [] as string[], [], "CachedTest", {
        cacheKey: "test-key",
        cacheTtlMs: 5000,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockCachedRequest).toHaveBeenCalledWith("test-key", fetchFn, 5000);
    expect(result.current.data).toEqual(["cached"]);
    // fetchFn should NOT be called directly (cachedRequest handles it)
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("calls fetchFn directly when no cacheKey", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ value: 42 });
    const extractData = (res: { value: number }) => res.value;

    const { result } = renderHook(() => useAsyncFetch(fetchFn, extractData, 0, [], "DirectTest"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchFn).toHaveBeenCalled();
    expect(mockCachedRequest).not.toHaveBeenCalled();
    expect(result.current.data).toBe(42);
  });

  it("applies extractData transform correctly", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ data: { nested: "value" } });
    const extractData = (res: { data: { nested: string } }) => res.data.nested;

    const { result } = renderHook(() =>
      useAsyncFetch(fetchFn, extractData, "", [], "TransformTest")
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBe("value");
  });

  it("refetches when deps change", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ v: 1 }).mockResolvedValueOnce({ v: 2 });
    const extractData = (res: { v: number }) => res.v;

    const { result, rerender } = renderHook(
      ({ dep }) => useAsyncFetch(fetchFn, extractData, 0, [dep], "DepsTest"),
      { initialProps: { dep: "a" } }
    );

    await waitFor(() => {
      expect(result.current.data).toBe(1);
    });

    rerender({ dep: "b" });

    await waitFor(() => {
      expect(result.current.data).toBe(2);
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not update state after unmount", async () => {
    let resolveFn: (value: { v: number }) => void = () => {};
    const fetchFn = vi.fn().mockReturnValue(
      new Promise<{ v: number }>((resolve) => {
        resolveFn = resolve;
      })
    );
    const extractData = (res: { v: number }) => res.v;

    const { result, unmount } = renderHook(() =>
      useAsyncFetch(fetchFn, extractData, 0, [], "UnmountTest")
    );

    expect(result.current.loading).toBe(true);

    unmount();
    resolveFn({ v: 99 });

    // Should not throw or update — data remains initial
    expect(result.current.data).toBe(0);
  });
});
