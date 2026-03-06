import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../api/client", () => ({
  addRepoToCategory: vi.fn(),
  removeRepoFromCategory: vi.fn(),
  getRepoCategories: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../utils/error", () => ({
  getErrorMessage: (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback,
}));

import { addRepoToCategory, removeRepoFromCategory, getRepoCategories } from "../../api/client";
import { useCategoryOperations } from "../useCategoryOperations";

const mockAdd = vi.mocked(addRepoToCategory);
const mockRemove = vi.mocked(removeRepoFromCategory);
const mockGetCategories = vi.mocked(getRepoCategories);

describe("useCategoryOperations", () => {
  const onSuccess = vi.fn<() => void>();
  const onError = vi.fn<(msg: string) => void>();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with isLoading false", () => {
    const { result } = renderHook(() => useCategoryOperations(onSuccess, onError));
    expect(result.current.isLoading).toBe(false);
  });

  it("addToCategory calls API and returns true on success", async () => {
    mockAdd.mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useCategoryOperations(onSuccess, onError));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.addToCategory(1, 42);
    });

    expect(success).toBe(true);
    expect(mockAdd).toHaveBeenCalledWith(1, 42);
    expect(onSuccess).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it("addToCategory returns false and calls onError on failure", async () => {
    mockAdd.mockRejectedValue(new Error("Add failed"));

    const { result } = renderHook(() => useCategoryOperations(onSuccess, onError));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.addToCategory(1, 42);
    });

    expect(success).toBe(false);
    expect(onError).toHaveBeenCalledWith("Add failed");
    expect(onSuccess).not.toHaveBeenCalled();
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
  });

  it("getCategories returns categories on success", async () => {
    const categories = [
      { id: 1, name: "Frontend" },
      { id: 2, name: "Backend" },
    ];
    mockGetCategories.mockResolvedValue({ categories } as never);

    const { result } = renderHook(() => useCategoryOperations(onSuccess, onError));

    let cats: { id: number; name: string }[] = [];
    await act(async () => {
      cats = await result.current.getCategories(42);
    });

    expect(cats).toEqual(categories);
    expect(mockGetCategories).toHaveBeenCalledWith(42);
  });

  it("getCategories returns empty array on failure", async () => {
    mockGetCategories.mockRejectedValue(new Error("Get failed"));

    const { result } = renderHook(() => useCategoryOperations(onSuccess, onError));

    let cats: { id: number; name: string }[] = [];
    await act(async () => {
      cats = await result.current.getCategories(42);
    });

    expect(cats).toEqual([]);
  });

  it("works without onSuccess/onError callbacks", async () => {
    mockAdd.mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useCategoryOperations());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.addToCategory(1, 42);
    });

    // Should not throw even without callbacks
    expect(success).toBe(true);
  });
});
