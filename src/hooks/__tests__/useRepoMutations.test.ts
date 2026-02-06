import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRepoMutations } from "../useRepoMutations";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    addRepo: vi.fn(),
    removeRepo: vi.fn(),
    fetchRepo: vi.fn(),
    fetchAllRepos: vi.fn(),
  };
});

function createMockDeps() {
  return {
    setRepos: vi.fn(),
    setError: vi.fn(),
    setLoadingRepoId: vi.fn(),
    setIsRefreshing: vi.fn(),
    errorMsg: "操作失敗",
    invalidFormatMsg: "格式無效",
  };
}

const mockRepo: apiClient.RepoWithSignals = {
  id: 1,
  owner: "facebook",
  name: "react",
  full_name: "facebook/react",
  url: "https://github.com/facebook/react",
  description: "A JavaScript library",
  language: "JavaScript",
  added_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  stars: 200000,
  forks: 40000,
  stars_delta_7d: 100,
  stars_delta_30d: 400,
  velocity: 14.3,
  acceleration: 0.5,
  trend: 1,
  last_fetched: "2024-01-01T00:00:00Z",
};

describe("useRepoMutations", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  describe("addNewRepo", () => {
    it("adds repo with owner/name format", async () => {
      vi.mocked(apiClient.addRepo).mockResolvedValue(mockRepo);
      const { result } = renderHook(() => useRepoMutations(deps));

      let res: { success: boolean; error?: string } = { success: false };
      await act(async () => {
        res = await result.current.addNewRepo("facebook/react");
      });

      expect(res.success).toBe(true);
      expect(apiClient.addRepo).toHaveBeenCalledWith({ owner: "facebook", name: "react" });
      expect(deps.setRepos).toHaveBeenCalled();
    });

    it("adds repo with GitHub URL format", async () => {
      vi.mocked(apiClient.addRepo).mockResolvedValue(mockRepo);
      const { result } = renderHook(() => useRepoMutations(deps));

      let res: { success: boolean; error?: string } = { success: false };
      await act(async () => {
        res = await result.current.addNewRepo("https://github.com/facebook/react");
      });

      expect(res.success).toBe(true);
      expect(apiClient.addRepo).toHaveBeenCalledWith({
        url: "https://github.com/facebook/react",
      });
    });

    it("returns error for invalid format (no slash)", async () => {
      const { result } = renderHook(() => useRepoMutations(deps));

      let res: { success: boolean; error?: string } = { success: false };
      await act(async () => {
        res = await result.current.addNewRepo("react");
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("格式無效");
      expect(apiClient.addRepo).not.toHaveBeenCalled();
    });

    it("returns error for too many parts (owner/name/extra)", async () => {
      const { result } = renderHook(() => useRepoMutations(deps));

      let res: { success: boolean; error?: string } = { success: false };
      await act(async () => {
        res = await result.current.addNewRepo("a/b/c");
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("格式無效");
    });

    it("returns error for empty parts (/name or owner/)", async () => {
      const { result } = renderHook(() => useRepoMutations(deps));

      let res1: { success: boolean; error?: string } = { success: true };
      let res2: { success: boolean; error?: string } = { success: true };
      await act(async () => {
        res1 = await result.current.addNewRepo("/react");
        res2 = await result.current.addNewRepo("facebook/");
      });

      expect(res1.success).toBe(false);
      expect(res2.success).toBe(false);
    });

    it("returns API error message on failure", async () => {
      vi.mocked(apiClient.addRepo).mockRejectedValue(
        new apiClient.ApiError(409, "Repository already exists")
      );
      const { result } = renderHook(() => useRepoMutations(deps));

      let res: { success: boolean; error?: string } = { success: false };
      await act(async () => {
        res = await result.current.addNewRepo("facebook/react");
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("Repository already exists");
    });

    it("returns fallback error for non-ApiError", async () => {
      vi.mocked(apiClient.addRepo).mockRejectedValue(new Error("Network error"));
      const { result } = renderHook(() => useRepoMutations(deps));

      let res: { success: boolean; error?: string } = { success: false };
      await act(async () => {
        res = await result.current.addNewRepo("facebook/react");
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("操作失敗");
    });
  });

  describe("deleteRepo", () => {
    it("deletes repo and updates state", async () => {
      vi.mocked(apiClient.removeRepo).mockResolvedValue(undefined);
      const { result } = renderHook(() => useRepoMutations(deps));

      let success = false;
      await act(async () => {
        success = await result.current.deleteRepo(1);
      });

      expect(success).toBe(true);
      expect(deps.setLoadingRepoId).toHaveBeenCalledWith(1);
      expect(deps.setRepos).toHaveBeenCalled();
      expect(deps.setLoadingRepoId).toHaveBeenCalledWith(null);
    });

    it("sets error on API failure", async () => {
      vi.mocked(apiClient.removeRepo).mockRejectedValue(
        new apiClient.ApiError(500, "Server error")
      );
      const { result } = renderHook(() => useRepoMutations(deps));

      let success = true;
      await act(async () => {
        success = await result.current.deleteRepo(1);
      });

      expect(success).toBe(false);
      expect(deps.setError).toHaveBeenCalledWith("Server error");
      expect(deps.setLoadingRepoId).toHaveBeenCalledWith(null);
    });
  });

  describe("refreshRepo", () => {
    it("refreshes repo and updates in list", async () => {
      const updatedRepo = { ...mockRepo, stars: 200100 };
      vi.mocked(apiClient.fetchRepo).mockResolvedValue(updatedRepo);
      const { result } = renderHook(() => useRepoMutations(deps));

      await act(async () => {
        await result.current.refreshRepo(1);
      });

      expect(deps.setLoadingRepoId).toHaveBeenCalledWith(1);
      expect(apiClient.fetchRepo).toHaveBeenCalledWith(1);
      expect(deps.setRepos).toHaveBeenCalled();
      expect(deps.setLoadingRepoId).toHaveBeenCalledWith(null);
    });

    it("sets error on failure", async () => {
      vi.mocked(apiClient.fetchRepo).mockRejectedValue(new Error("timeout"));
      const { result } = renderHook(() => useRepoMutations(deps));

      await act(async () => {
        await result.current.refreshRepo(1);
      });

      expect(deps.setError).toHaveBeenCalledWith("操作失敗");
    });
  });

  describe("refreshAllRepos", () => {
    it("refreshes all repos and replaces state", async () => {
      vi.mocked(apiClient.fetchAllRepos).mockResolvedValue({
        repos: [mockRepo],
        total: 1,
      });
      const { result } = renderHook(() => useRepoMutations(deps));

      await act(async () => {
        await result.current.refreshAllRepos();
      });

      expect(deps.setIsRefreshing).toHaveBeenCalledWith(true);
      expect(deps.setRepos).toHaveBeenCalledWith([mockRepo]);
      expect(deps.setError).toHaveBeenCalledWith(null);
      expect(deps.setIsRefreshing).toHaveBeenCalledWith(false);
    });

    it("sets error on failure", async () => {
      vi.mocked(apiClient.fetchAllRepos).mockRejectedValue(new Error("fail"));
      const { result } = renderHook(() => useRepoMutations(deps));

      await act(async () => {
        await result.current.refreshAllRepos();
      });

      expect(deps.setError).toHaveBeenCalledWith("操作失敗");
      expect(deps.setIsRefreshing).toHaveBeenCalledWith(false);
    });
  });
});
