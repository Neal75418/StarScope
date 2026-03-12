import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useGenericSummary } from "../useGenericSummary";
import { createTestQueryClient } from "../../lib/react-query";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

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

    const { result } = renderHook(() => useGenericSummary(defaultConfig), {
      wrapper: createWrapper(),
    });

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

    const { result } = renderHook(() => useGenericSummary(defaultConfig), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.summary).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("handles non-404 error by setting error state", async () => {
    defaultConfig.getSummary.mockRejectedValue(new Error("Server error"));

    const { result } = renderHook(() => useGenericSummary(defaultConfig), {
      wrapper: createWrapper(),
    });

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

    const { result, unmount } = renderHook(() => useGenericSummary(defaultConfig), {
      wrapper: createWrapper(),
    });
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

    // Provide enough mock responses:
    // 1. Initial query call -> initialData
    // 2. Mutation's getSummary call -> refreshedData
    // 3. Possible background refetch after setQueryData (staleTime=0) -> refreshedData
    defaultConfig.getSummary
      .mockResolvedValueOnce(initialData)
      .mockResolvedValueOnce(refreshedData)
      .mockResolvedValue(refreshedData);
    defaultConfig.triggerFetch.mockResolvedValue(undefined);

    const { result } = renderHook(() => useGenericSummary(defaultConfig), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.summary).toEqual(initialData);

    await act(async () => {
      await result.current.fetchData();
    });

    expect(defaultConfig.triggerFetch).toHaveBeenCalledWith(1);

    await waitFor(() => {
      expect(result.current.summary).toEqual(refreshedData);
    });
    expect(result.current.fetching).toBe(false);
  });

  it("refetches when repoId changes", async () => {
    const data1 = { id: 1 };
    const data2 = { id: 2 };

    defaultConfig.getSummary.mockResolvedValueOnce(data1).mockResolvedValueOnce(data2);

    const { result, rerender } = renderHook(
      ({ repoId }) => useGenericSummary({ ...defaultConfig, repoId }),
      { initialProps: { repoId: 1 }, wrapper: createWrapper() }
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
