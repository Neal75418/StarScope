/**
 * 側欄分類樹放在 React Query 裡、key 在 repos 前綴底下：任何重取 repo 清單的入口
 * （加入、取消追蹤、移出分類、設定頁復原、同步……）都會帶著它重讀，數量才不會停在舊值。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCategoryTree } from "../useCategoryTree";
import * as apiClient from "../../api/client";
import { invalidateTrackedRepos, queryKeys } from "../../lib/react-query";

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

function renderTree() {
  // 一般的 client（不是 createTestQueryClient）：測試用的 gcTime 是 0，沒人觀察的快取會被回收，
  // 「新增分類時清掉成員快取」那類斷言會因此空過
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, ...renderHook(() => useCategoryTree(), { wrapper }) };
}

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
  const created = {
    id: 2,
    name: "Backend",
    description: null,
    icon: null,
    color: null,
    parent_id: null,
    sort_order: 1,
    created_at: "2024-01-01",
    repo_count: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getCategoryTree).mockReset();
    vi.mocked(apiClient.createCategory).mockReset();
    vi.mocked(apiClient.updateCategory).mockReset();
    vi.mocked(apiClient.deleteCategory).mockReset();
  });

  it("returns initial loading state", () => {
    vi.mocked(apiClient.getCategoryTree).mockImplementation(() => new Promise(() => {}));

    const { result } = renderTree();

    expect(result.current.loading).toBe(true);
    expect(result.current.tree).toEqual([]);
    expect(result.current.error).toBe(null);
  });

  it("loads category tree successfully", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ tree: mockTree, total: 1 });

    const { result } = renderTree();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tree).toEqual(mockTree);
    expect(result.current.error).toBe(null);
    expect(result.current.reloadFailed).toBe(false);
  });

  it("handles fetch error", async () => {
    vi.mocked(apiClient.getCategoryTree).mockRejectedValue(new Error("Network error"));

    const { result } = renderTree();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to load categories");
    expect(apiClient.getCategoryTree).toHaveBeenCalledTimes(1);
  });

  it("keeps the last tree and shows no error when a later refetch fails", async () => {
    // 錯誤畫面會取代整個側欄，連開著的編輯框、刪除確認都一起卸掉：只在從沒載入成功時才顯示
    vi.mocked(apiClient.getCategoryTree)
      .mockResolvedValueOnce({ tree: mockTree, total: 1 })
      .mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderTree();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetchCategories();
    });
    // React Query 以 setTimeout(0) 才通知畫面：不等這一拍，斷言看到的是失敗前的結果，永遠是 null
    await act(() => new Promise<void>((r) => setTimeout(r, 20)));

    expect(apiClient.getCategoryTree).toHaveBeenCalledTimes(2);
    expect(result.current.tree).toEqual(mockTree);
    expect(result.current.error).toBe(null);
    // 但要讓頁面說出來：例如新增分類後重讀失敗，表單已關、側欄卻看不到新分類，使用者會再建一次
    expect(result.current.reloadFailed).toBe(true);
  });

  it("creates a category and reloads the tree", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ tree: mockTree, total: 1 });
    vi.mocked(apiClient.createCategory).mockResolvedValue(created);

    const { result } = renderTree();
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success = false;
    await act(async () => {
      success = await result.current.handleCreateCategory("Backend");
    });

    expect(success).toBe(true);
    expect(apiClient.createCategory).toHaveBeenCalledWith({ name: "Backend" });
    await waitFor(() => expect(apiClient.getCategoryTree).toHaveBeenCalledTimes(2));
  });

  it("handles create category error", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ tree: mockTree, total: 1 });
    vi.mocked(apiClient.createCategory).mockRejectedValue(new Error("Create failed"));

    const { result } = renderTree();
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success = true;
    await act(async () => {
      success = await result.current.handleCreateCategory("Backend");
    });

    expect(success).toBe(false);
  });

  it("updates a category and reloads the tree", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ tree: mockTree, total: 1 });
    vi.mocked(apiClient.updateCategory).mockResolvedValue({ ...created, id: 1, name: "Updated" });

    const { client, result } = renderTree();
    await waitFor(() => expect(result.current.loading).toBe(false));
    client.setQueryData(queryKeys.repos.lists(), []);

    let success = false;
    await act(async () => {
      success = await result.current.handleUpdateCategory(1, { name: "Updated" });
    });

    expect(success).toBe(true);
    expect(apiClient.updateCategory).toHaveBeenCalledWith(1, { name: "Updated" });
    await waitFor(() => expect(apiClient.getCategoryTree).toHaveBeenCalledTimes(2));
    // 改名不改任何 repo 屬於哪些分類，不必連整份追蹤清單一起重抓
    expect(client.getQueryState(queryKeys.repos.lists())?.isInvalidated).toBe(false);
  });

  it("keeps showing the current tree while it reloads after a change", async () => {
    // 以前每次重讀都整塊換成 Loading，編輯框與刪除確認也跟著被卸掉
    vi.mocked(apiClient.getCategoryTree)
      .mockResolvedValueOnce({ tree: mockTree, total: 1 })
      .mockImplementationOnce(() => new Promise(() => {}));
    vi.mocked(apiClient.updateCategory).mockResolvedValue({ ...created, id: 1, name: "Updated" });

    const { result } = renderTree();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleUpdateCategory(1, { name: "Updated" });
    });

    await waitFor(() => expect(apiClient.getCategoryTree).toHaveBeenCalledTimes(2));
    expect(result.current.loading).toBe(false);
    expect(result.current.tree).toEqual(mockTree);
  });

  it("handles update category error", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ tree: mockTree, total: 1 });
    vi.mocked(apiClient.updateCategory).mockRejectedValue(new Error("Update failed"));

    const { result } = renderTree();
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success = true;
    await act(async () => {
      success = await result.current.handleUpdateCategory(1, { name: "Updated" });
    });

    expect(success).toBe(false);
  });

  it("deletes a category and reloads the tracked repos along with the tree", async () => {
    // 刪掉的分類的成員關係跟著消失，各 repo 的 category_ids 要重讀：categories 沒有 AUTOINCREMENT，
    // 新分類可能重用這個 id，留著舊的 category_ids 會讓那些 repo 出現在新分類裡
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ tree: mockTree, total: 1 });
    vi.mocked(apiClient.deleteCategory).mockResolvedValue({ status: "ok", message: "Deleted" });

    const { client, result } = renderTree();
    await waitFor(() => expect(result.current.loading).toBe(false));
    client.setQueryData(queryKeys.repos.lists(), []);

    let success = false;
    await act(async () => {
      success = await result.current.handleDeleteCategory(1);
    });

    expect(success).toBe(true);
    expect(apiClient.deleteCategory).toHaveBeenCalledWith(1);
    await waitFor(() => expect(apiClient.getCategoryTree).toHaveBeenCalledTimes(2));
    expect(client.getQueryState(queryKeys.repos.lists())?.isInvalidated).toBe(true);
  });

  it("handles delete category error", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ tree: mockTree, total: 1 });
    vi.mocked(apiClient.deleteCategory).mockRejectedValue(new Error("Delete failed"));

    const { result } = renderTree();
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success = true;
    await act(async () => {
      success = await result.current.handleDeleteCategory(1);
    });

    expect(success).toBe(false);
  });

  it("create returns true even when post-mutation reload fails", async () => {
    vi.mocked(apiClient.getCategoryTree)
      .mockResolvedValueOnce({ tree: mockTree, total: 1 })
      .mockRejectedValueOnce(new Error("Reload failed"));
    vi.mocked(apiClient.createCategory).mockResolvedValue(created);

    const { result } = renderTree();
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success = false;
    await act(async () => {
      success = await result.current.handleCreateCategory("Backend");
    });

    expect(success).toBe(true);
    expect(apiClient.createCategory).toHaveBeenCalled();
  });

  it("a reload during the first load joins it instead of sending a second request", async () => {
    let resolveFirst: (v: { tree: typeof mockTree; total: number }) => void = () => {};
    vi.mocked(apiClient.getCategoryTree).mockReturnValueOnce(
      new Promise((r) => {
        resolveFirst = r;
      })
    );

    const { result } = renderTree();

    await act(async () => {
      void result.current.fetchCategories();
    });
    await act(async () => {
      resolveFirst({ tree: mockTree, total: 1 });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiClient.getCategoryTree).toHaveBeenCalledTimes(1);
    expect(result.current.tree).toEqual(mockTree);
  });

  it("fetchCategories triggers a re-fetch", async () => {
    vi.mocked(apiClient.getCategoryTree).mockResolvedValue({ tree: mockTree, total: 1 });

    const { result } = renderTree();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetchCategories();
    });

    expect(apiClient.getCategoryTree).toHaveBeenCalledTimes(2);
  });

  it("reloads when anything refetches the tracked repos", async () => {
    // 移出分類、加入分類、取消追蹤、設定頁復原……都以 invalidateTrackedRepos 收尾，側欄數量要跟著變
    vi.mocked(apiClient.getCategoryTree)
      .mockResolvedValueOnce({ tree: mockTree, total: 1 })
      .mockResolvedValueOnce({ tree: [{ ...mockTree[0], repo_count: 4 }], total: 1 });

    const { client, result } = renderTree();
    await waitFor(() => expect(result.current.tree[0]?.repo_count).toBe(5));

    act(() => invalidateTrackedRepos(client));

    await waitFor(() => expect(result.current.tree[0]?.repo_count).toBe(4));
  });
});
