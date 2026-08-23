/**
 * WatchlistContext 是所有寫入操作的必經之路（addRepo / removeRepo / fetchRepo /
 * refreshAll / recalculateAll），先前覆蓋率 1.4%、沒有測試檔。
 *
 * 這裡守的是 reducer 測不到的那一層：呼叫哪支 API、失敗怎麼分類、成功後有沒有
 * invalidate。reducer 的狀態轉移已經在 watchlistReducer.test.ts 驗過，不重複。
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../lib/react-query";
import { ApiError } from "../../api/types";
import { WatchlistProvider, useWatchlistActions, useWatchlistState } from "../WatchlistContext";

const mockAddRepo = vi.fn();
const mockUnstarRepo = vi.fn();
const mockFetchAllRepos = vi.fn();

// 只換掉會打網路的那幾支，其餘（尤其 ApiError——client 從 ./types 再匯出它，
// 整包換掉會讓 getErrorMessage 的 instanceof 檢查拿到 undefined）保留真身
vi.mock("../../api/client", async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  addRepo: (...a: unknown[]) => mockAddRepo(...a),
  unstarRepo: (...a: unknown[]) => mockUnstarRepo(...a),
  fetchRepo: vi.fn(() => Promise.resolve()),
  fetchAllRepos: (...a: unknown[]) => mockFetchAllRepos(...a),
  recalculateAllSimilarities: vi.fn(() => Promise.resolve()),
  getCategoryRepos: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../hooks/useReposQuery", () => ({
  useReposQuery: () => ({ data: [], isLoading: false, error: null }),
}));

vi.mock("../AppStatusContext", () => ({
  useAppStatus: () => ({ isSidecarUp: true, level: "online" }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = createTestQueryClient();
  return (
    <QueryClientProvider client={client}>
      <WatchlistProvider>{children}</WatchlistProvider>
    </QueryClientProvider>
  );
}

function renderCtx() {
  return renderHook(() => ({ actions: useWatchlistActions(), state: useWatchlistState() }), {
    wrapper,
  });
}

describe("WatchlistContext actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddRepo.mockResolvedValue(undefined);
    mockUnstarRepo.mockResolvedValue(undefined);
    mockFetchAllRepos.mockResolvedValue(undefined);
  });

  describe("refreshAll", () => {
    it("treats 409 as in progress, not as a failure", async () => {
      // 後端撞到排程中的抓取時回 409。使用者要的結果正在發生——報錯只會讓他
      // 再按一次，而那次同樣會撞到鎖。進行中的顯示由 diagnostics 的
      // fetch_in_progress 接手。
      mockFetchAllRepos.mockRejectedValue(new ApiError(409, "Fetch already in progress"));
      const { result } = renderCtx();

      await act(async () => {
        await result.current.actions.refreshAll();
      });

      await waitFor(() => expect(result.current.state.error).toBeNull());
      expect(result.current.state.loadingState.type).not.toBe("refreshing");
    });

    it("still reports real failures", async () => {
      // 409 那條捷徑不能寬到把所有錯誤都吞掉
      mockFetchAllRepos.mockRejectedValue(new ApiError(500, "boom"));
      const { result } = renderCtx();

      await act(async () => {
        await result.current.actions.refreshAll();
      });

      await waitFor(() => expect(result.current.state.error).toBeTruthy());
    });

    it("calls the endpoint exactly once per invocation", async () => {
      // 有副作用又不冪等，重複呼叫會對 94 個 repo 各多打一輪 GitHub
      const { result } = renderCtx();
      await act(async () => {
        await result.current.actions.refreshAll();
      });
      expect(mockFetchAllRepos).toHaveBeenCalledTimes(1);
    });
  });

  describe("addRepo", () => {
    it("rejects an unparseable input without calling the API", async () => {
      const { result } = renderCtx();
      let ret: { success: boolean; error?: string } | undefined;

      await act(async () => {
        ret = await result.current.actions.addRepo("not a repo!!");
      });

      expect(ret?.success).toBe(false);
      expect(ret?.error).toBeTruthy();
      // 格式錯誤是本機就能判斷的事，不該浪費一趟往返
      expect(mockAddRepo).not.toHaveBeenCalled();
    });

    it("passes owner and name through, not the raw string", async () => {
      const { result } = renderCtx();

      await act(async () => {
        await result.current.actions.addRepo("facebook/react");
      });

      expect(mockAddRepo).toHaveBeenCalledWith({ owner: "facebook", name: "react" });
    });

    it("returns the server's message on failure instead of a generic one", async () => {
      mockAddRepo.mockRejectedValue(new ApiError(404, "Repository not found"));
      const { result } = renderCtx();
      let ret: { success: boolean; error?: string } | undefined;

      await act(async () => {
        ret = await result.current.actions.addRepo("nope/nope");
      });

      expect(ret?.success).toBe(false);
      expect(ret?.error).toContain("Repository not found");
    });
  });

  describe("removeRepo", () => {
    it("rethrows so the caller can keep the confirm dialog open", async () => {
      // 這裡與 addRepo 刻意不同：addRepo 回傳 {success,error}，removeRepo 往外拋。
      // 吞掉的話刪除失敗時對話框會關閉，使用者以為刪掉了。
      mockUnstarRepo.mockRejectedValue(new ApiError(500, "boom"));
      const { result } = renderCtx();

      await expect(
        act(async () => {
          await result.current.actions.removeRepo(1);
        })
      ).rejects.toThrow();
    });
  });
});
