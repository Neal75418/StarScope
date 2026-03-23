import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../lib/react-query";
import { useStarredImport } from "../useStarredImport";

const mockBatchAddRepos = vi.fn();
const mockGetStarredRepos = vi.fn();

vi.mock("../../api/client", () => ({
  batchAddRepos: (...args: unknown[]) => mockBatchAddRepos(...args),
  getStarredRepos: (...args: unknown[]) => mockGetStarredRepos(...args),
}));

function createWrapper() {
  const client = createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe("useStarredImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reset during in-flight import discards stale result", async () => {
    let resolveBatch: (value: unknown) => void = () => undefined;
    mockBatchAddRepos.mockReturnValue(
      new Promise((resolve) => {
        resolveBatch = resolve;
      })
    );

    const { result } = renderHook(() => useStarredImport(), {
      wrapper: createWrapper(),
    });

    // Select a repo
    act(() => {
      result.current.toggleRepo("a/b");
    });

    // Start import (will hang on the promise)
    let importPromise: Promise<void>;
    act(() => {
      importPromise = result.current.startImport();
    });

    expect(result.current.isImporting).toBe(true);

    // Reset while import is in-flight
    act(() => {
      result.current.reset();
    });

    // After reset: isImporting should be false, result null
    expect(result.current.isImporting).toBe(false);
    expect(result.current.result).toBeNull();

    // Now resolve the stale promise — should NOT update state
    await act(async () => {
      resolveBatch({ total: 1, success: 1, skipped: 0, failed: 0, errors: [] });
      await importPromise;
    });

    // State should remain reset — stale result discarded
    expect(result.current.isImporting).toBe(false);
    expect(result.current.result).toBeNull();
    expect(result.current.importError).toBeNull();
  });

  it("reset during in-flight import discards stale error", async () => {
    let rejectBatch: (reason: Error) => void = () => undefined;
    mockBatchAddRepos.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectBatch = reject;
      })
    );

    const { result } = renderHook(() => useStarredImport(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.toggleRepo("c/d");
    });

    let importPromise: Promise<void>;
    act(() => {
      importPromise = result.current.startImport();
    });

    // Reset while in-flight
    act(() => {
      result.current.reset();
    });

    // Reject the stale promise
    await act(async () => {
      rejectBatch(new Error("Network error"));
      await importPromise;
    });

    // importError should remain null — stale error discarded
    expect(result.current.importError).toBeNull();
    expect(result.current.isImporting).toBe(false);
  });

  it("successful import sets result when not reset", async () => {
    const importResult = { total: 1, success: 1, skipped: 0, failed: 0, errors: [] };
    mockBatchAddRepos.mockResolvedValue(importResult);

    const { result } = renderHook(() => useStarredImport(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.toggleRepo("e/f");
    });

    await act(async () => {
      await result.current.startImport();
    });

    await waitFor(() => {
      expect(result.current.result).toEqual(importResult);
      expect(result.current.isImporting).toBe(false);
    });
  });

  it("failed import sets importError when not reset", async () => {
    mockBatchAddRepos.mockRejectedValue(new Error("Server error"));

    const { result } = renderHook(() => useStarredImport(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.toggleRepo("g/h");
    });

    await act(async () => {
      await result.current.startImport();
    });

    await waitFor(() => {
      expect(result.current.importError).toBe("Server error");
      expect(result.current.isImporting).toBe(false);
    });
  });
});
