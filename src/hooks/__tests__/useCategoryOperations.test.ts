import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../api/client", () => ({
  removeRepoFromCategory: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../utils/error", () => ({
  getErrorMessage: (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback,
}));

import { removeRepoFromCategory } from "../../api/client";
import { useCategoryOperations } from "../useCategoryOperations";

const mockRemove = vi.mocked(removeRepoFromCategory);

describe("useCategoryOperations", () => {
  const onSuccess = vi.fn<() => void>();
  const onError = vi.fn<(msg: string) => void>();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removeFromCategory calls API and returns true on success", async () => {
    mockRemove.mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useCategoryOperations(onSuccess, onError));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.removeFromCategory(1, 42);
    });

    expect(success).toBe(true);
    expect(mockRemove).toHaveBeenCalledWith(1, 42);
    expect(onSuccess).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("removeFromCategory returns false on failure", async () => {
    mockRemove.mockRejectedValue(new Error("Remove failed"));

    const { result } = renderHook(() => useCategoryOperations(onSuccess, onError));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.removeFromCategory(1, 42);
    });

    expect(success).toBe(false);
    expect(onError).toHaveBeenCalledWith("Remove failed");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("works without onSuccess/onError callbacks", async () => {
    mockRemove.mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useCategoryOperations());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.removeFromCategory(1, 42);
    });

    // Should not throw even without callbacks
    expect(success).toBe(true);
  });
});
