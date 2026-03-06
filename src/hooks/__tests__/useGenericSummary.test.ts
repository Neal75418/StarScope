import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGenericSummary } from "../useGenericSummary";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe("useGenericSummary", () => {
  const defaultConfig = {
    repoId: 1,
    failedToLoadMessage: "Failed to load summary",
    getSummary: vi.fn(),
    triggerFetch: vi.fn(),
    logPrefix: "Test",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in loading state then resolves with data", async () => {
    const mockData = { count: 42, items: ["a", "b"] };
    defaultConfig.getSummary.mockResolvedValue(mockData);

    const { result } = renderHook(() => useGenericSummary(defaultConfig));

    // Initially loading
    expect(result.current.loading).toBe(true);
    expect(result.current.summary).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.summary).toEqual(mockData);
    expect(result.current.error).toBeNull();
  });

  it("handles 404 error by setting summary to null (not error)", async () => {
    const notFoundError = { status: 404, message: "Not found" };
    defaultConfig.getSummary.mockRejectedValue(notFoundError);

    const { result } = renderHook(() => useGenericSummary(defaultConfig));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.summary).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("handles non-404 error by setting error state", async () => {
    defaultConfig.getSummary.mockRejectedValue(new Error("Server error"));

    const { result } = renderHook(() => useGenericSummary(defaultConfig));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load summary");
    expect(result.current.summary).toBeNull();
  });

  it("does not update state after unmount", async () => {
    let resolveFn: (value: unknown) => void = () => {};
    defaultConfig.getSummary.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      })
    );

    const { result, unmount } = renderHook(() => useGenericSummary(defaultConfig));
    expect(result.current.loading).toBe(true);

    unmount();
    // Resolve after unmount — should not throw or update state
    resolveFn({ data: "late" });

    // No error should occur
    expect(result.current.loading).toBe(true);
  });

  it("fetchData triggers triggerFetch then getSummary", async () => {
    const initialData = { value: "initial" };
    const refreshedData = { value: "refreshed" };

    defaultConfig.getSummary
      .mockResolvedValueOnce(initialData)
      .mockResolvedValueOnce(refreshedData);
    defaultConfig.triggerFetch.mockResolvedValue(undefined);

    const { result } = renderHook(() => useGenericSummary(defaultConfig));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.summary).toEqual(initialData);

    await act(async () => {
      await result.current.fetchData();
    });

    expect(defaultConfig.triggerFetch).toHaveBeenCalledWith(1);
    expect(result.current.summary).toEqual(refreshedData);
    expect(result.current.fetching).toBe(false);
  });

  it("prevents concurrent fetchData calls", async () => {
    defaultConfig.getSummary.mockResolvedValue({ v: 1 });
    defaultConfig.triggerFetch.mockResolvedValue(undefined);

    const { result } = renderHook(() => useGenericSummary(defaultConfig));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Call fetchData twice concurrently
    await act(async () => {
      const p1 = result.current.fetchData();
      const p2 = result.current.fetchData();
      await Promise.all([p1, p2]);
    });

    // triggerFetch should only be called once (second call skipped)
    expect(defaultConfig.triggerFetch).toHaveBeenCalledTimes(1);
  });

  it("refetches when repoId changes", async () => {
    const data1 = { id: 1 };
    const data2 = { id: 2 };

    defaultConfig.getSummary.mockResolvedValueOnce(data1).mockResolvedValueOnce(data2);

    const { result, rerender } = renderHook(
      ({ repoId }) => useGenericSummary({ ...defaultConfig, repoId }),
      { initialProps: { repoId: 1 } }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.summary).toEqual(data1);

    rerender({ repoId: 2 });

    await waitFor(() => {
      expect(result.current.summary).toEqual(data2);
    });

    expect(defaultConfig.getSummary).toHaveBeenCalledTimes(2);
  });
});
