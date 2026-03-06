import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAsyncOperation } from "../useAsyncOperation";
import type { Toast } from "../types";

describe("useAsyncOperation", () => {
  let mockToast: Toast;

  beforeEach(() => {
    mockToast = {
      success: vi.fn(),
      error: vi.fn(),
    };
  });

  it("starts with isSubmitting false", () => {
    const { result } = renderHook(() => useAsyncOperation(mockToast));
    expect(result.current.isSubmitting).toBe(false);
  });

  it("returns true and shows success toast on successful operation", async () => {
    const operation = vi.fn().mockResolvedValue("done");
    const { result } = renderHook(() => useAsyncOperation(mockToast));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.execute(operation, "Operation completed");
    });

    expect(success).toBe(true);
    expect(mockToast.success).toHaveBeenCalledWith("Operation completed");
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(result.current.isSubmitting).toBe(false);
  });

  it("returns true without toast when no successMessage", async () => {
    const operation = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAsyncOperation(mockToast));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.execute(operation);
    });

    expect(success).toBe(true);
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("returns false and shows error toast on failed operation", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("Something broke"));
    const { result } = renderHook(() => useAsyncOperation(mockToast));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.execute(operation, "Success!");
    });

    expect(success).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith("Something broke");
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(result.current.isSubmitting).toBe(false);
  });

  it("uses fallback error message for non-Error exceptions", async () => {
    const operation = vi.fn().mockRejectedValue("raw string");
    const { result } = renderHook(() => useAsyncOperation(mockToast));

    await act(async () => {
      await result.current.execute(operation);
    });

    // getErrorMessage returns fallback t.common.error ("Error") for non-Error values
    expect(mockToast.error).toHaveBeenCalledWith("Error");
  });

  it("sets isSubmitting true during operation", async () => {
    let resolveFn: () => void = () => {};
    const operation = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolveFn = resolve;
      })
    );

    const { result } = renderHook(() => useAsyncOperation(mockToast));

    let executePromise: Promise<boolean>;
    act(() => {
      executePromise = result.current.execute(operation);
    });

    // During execution
    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      resolveFn();
      await executePromise;
    });

    expect(result.current.isSubmitting).toBe(false);
  });
});
