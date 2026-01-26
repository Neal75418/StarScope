import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCategoryTree } from "../useCategoryTree";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getCategoryTree: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
  };
});

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: {
      categories: {
        loadError: "Failed to load categories",
      },
    },
  }),
}));

describe("useCategoryTree", () => {
  const mockTree: apiClient.CategoryTreeNode[] = [
    {
      id: 1,
      name: "Frontend",
      description: null,
      icon: "🎨",
      color: "#3b82f6",
      sort_order: 0,
      repo_count: 5,
      children: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getCategoryTree).mockReset();
    vi.mocked(apiClient.createCategory).mockReset();
    vi.mocked(apiClient.updateCategory).mockReset();
    vi.mocked(apiClient.deleteCategory).mockReset();
  });

  it("returns initial loading state", () => {
    vi.mocked(apiClient.getCategoryTree).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useCategoryTree());

    expect(result.current.loading).toBe(true);
    expect(result.current.tree).toEqual([]);
    expect(result.current.error).toBe(null);
  });

  it("loads category tree successfully", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({
      tree: mockTree,
      total: 1,
    });

    const { result } = renderHook(() => useCategoryTree());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.tree).toEqual(mockTree);
    expect(result.current.error).toBe(null);
  });

  it("handles fetch error", async () => {
    vi.mocked(apiClient.getCategoryTree).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useCategoryTree());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to load categories");
  });

  it("creates category successfully", async () => {
    const mockOnChange = vi.fn();
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ tree: mockTree, total: 1 });
    vi.mocked(apiClient.createCategory).mockResolvedValue({
      id: 2,
      name: "Backend",
      description: null,
      icon: null,
      color: null,
      parent_id: null,
      sort_order: 1,
      created_at: "2024-01-01",
      repo_count: 0,
    });

    const { result } = renderHook(() => useCategoryTree(mockOnChange));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success: boolean = false;
    await act(async () => {
      success = await result.current.handleCreateCategory("Backend");
    });

    expect(success).toBe(true);
    expect(apiClient.createCategory).toHaveBeenCalledWith({ name: "Backend" });
    expect(mockOnChange).toHaveBeenCalled();
  });

  it("handles create category error", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ tree: mockTree, total: 1 });
    vi.mocked(apiClient.createCategory).mockRejectedValue(new Error("Create failed"));

    const { result } = renderHook(() => useCategoryTree());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success: boolean = true;
    await act(async () => {
      success = await result.current.handleCreateCategory("Backend");
    });

    expect(success).toBe(false);
  });

  it("updates category successfully", async () => {
    const mockOnChange = vi.fn();
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ tree: mockTree, total: 1 });
    vi.mocked(apiClient.updateCategory).mockResolvedValue({
      id: 1,
      name: "Updated",
      description: null,
      icon: null,
      color: null,
      parent_id: null,
      sort_order: 0,
      created_at: "2024-01-01",
      repo_count: 5,
    });

    const { result } = renderHook(() => useCategoryTree(mockOnChange));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success: boolean = false;
    await act(async () => {
      success = await result.current.handleUpdateCategory(1, { name: "Updated" });
    });

    expect(success).toBe(true);
    expect(apiClient.updateCategory).toHaveBeenCalledWith(1, { name: "Updated" });
    expect(mockOnChange).toHaveBeenCalled();
  });

  it("handles update category error", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ tree: mockTree, total: 1 });
    vi.mocked(apiClient.updateCategory).mockRejectedValue(new Error("Update failed"));

    const { result } = renderHook(() => useCategoryTree());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success: boolean = true;
    await act(async () => {
      success = await result.current.handleUpdateCategory(1, { name: "Updated" });
    });

    expect(success).toBe(false);
  });

  it("deletes category successfully", async () => {
    const mockOnChange = vi.fn();
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ tree: mockTree, total: 1 });
    vi.mocked(apiClient.deleteCategory).mockResolvedValue({ status: "ok", message: "Deleted" });

    const { result } = renderHook(() => useCategoryTree(mockOnChange));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success: boolean = false;
    await act(async () => {
      success = await result.current.handleDeleteCategory(1);
    });

    expect(success).toBe(true);
    expect(apiClient.deleteCategory).toHaveBeenCalledWith(1);
    expect(mockOnChange).toHaveBeenCalled();
  });

  it("handles delete category error", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ tree: mockTree, total: 1 });
    vi.mocked(apiClient.deleteCategory).mockRejectedValue(new Error("Delete failed"));

    const { result } = renderHook(() => useCategoryTree());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let success: boolean = true;
    await act(async () => {
      success = await result.current.handleDeleteCategory(1);
    });

    expect(success).toBe(false);
  });

  it("exposes fetchCategories function", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ tree: mockTree, total: 1 });

    const { result } = renderHook(() => useCategoryTree());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(typeof result.current.fetchCategories).toBe("function");
  });
});
