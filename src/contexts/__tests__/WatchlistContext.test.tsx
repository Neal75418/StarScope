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
import { createTestQueryClient, queryKeys } from "../../lib/react-query";
import { ApiError } from "../../api/types";
import { WatchlistProvider, useWatchlistActions, useWatchlistState } from "../WatchlistContext";

const mockAddRepo = vi.fn();
const mockUnstarRepo = vi.fn();
const mockFetchAllRepos = vi.fn();
const mockGetSyncStatus = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ last_sync_at: null, running: false })
);

// 只換掉會打網路的那幾支，其餘（尤其 ApiError——client 從 ./types 再匯出它，
// 整包換掉會讓 getErrorMessage 的 instanceof 檢查拿到 undefined）保留真身
vi.mock("../../api/client", async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  addRepo: (...a: unknown[]) => mockAddRepo(...a),
  unstarRepo: (...a: unknown[]) => mockUnstarRepo(...a),
  fetchRepo: vi.fn(() => Promise.resolve()),
  fetchAllRepos: (...a: unknown[]) => mockFetchAllRepos(...a),
  recalculateAllSimilarities: vi.fn(() => Promise.resolve()),
  // 背景同步的輪詢：不換掉的話會打到真的 sidecar
  getSyncStatus: (...a: unknown[]) => mockGetSyncStatus(...a),
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

    it("surfaces partial failure as a toast — 94/94 failed still returns 200", async () => {
      // 後端把失敗數放進 data（message 會被 apiCall 丟棄）。沒有這個 toast，
      // 轉圈結束＝使用者以為資料是新的，實際上畫面全是舊快照（第三方審查發現）。
      mockFetchAllRepos.mockResolvedValue({
        repos: [],
        total: 0,
        success_count: 0,
        failed_count: 94,
      });
      const { result } = renderCtx();

      await act(async () => {
        await result.current.actions.refreshAll();
      });

      // toast 內容包含失敗數；toast 狀態存在 context 的 toasts 裡
      await waitFor(() => {
        const text = JSON.stringify(result.current.state);
        expect(text).toContain("94");
      });
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

  describe("清單成員變動時讓訊號快取失效", () => {
    // 摘要與清單都不算封存 repo 的訊號：取消追蹤後「有訊號」要立刻減少，
    // 重新加入一個封存過的 repo 時它原本的訊號要重新出現
    function renderWithClient() {
      const client = createTestQueryClient();
      const invalidate = vi.spyOn(client, "invalidateQueries");
      const Wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <WatchlistProvider>{children}</WatchlistProvider>
        </QueryClientProvider>
      );
      const hook = renderHook(() => useWatchlistActions(), { wrapper: Wrapper });
      const invalidated = (key: readonly unknown[]) =>
        invalidate.mock.calls.some(
          (call) => JSON.stringify(call[0]?.queryKey) === JSON.stringify(key)
        );
      const signalsInvalidated = () => invalidated(queryKeys.signals.all);
      const rulesInvalidated = () => invalidated(queryKeys.alertRuleData.rules());
      return { actions: () => hook.result.current, signalsInvalidated, rulesInvalidated };
    }

    it("取消追蹤成功後", async () => {
      const { actions, signalsInvalidated } = renderWithClient();

      await act(async () => {
        await actions().removeRepo(1);
      });

      expect(signalsInvalidated()).toBe(true);
    });

    it("從確認對話框取消追蹤成功後", async () => {
      // 追蹤清單的「移除」按鈕走的是這條，不是 removeRepo
      const { actions, signalsInvalidated } = renderWithClient();

      act(() => actions().openRemoveConfirm(1, "o/n"));
      await act(async () => {
        await actions().confirmRemove();
      });

      expect(mockUnstarRepo).toHaveBeenCalledWith(1);
      expect(signalsInvalidated()).toBe(true);
    });

    it("加入追蹤成功後", async () => {
      const { actions, signalsInvalidated } = renderWithClient();

      await act(async () => {
        await actions().addRepo("o/n");
      });

      expect(signalsInvalidated()).toBe(true);
    });

    it("invalidateRepos 連警報規則清單一起重取", () => {
      // 加入／取消追蹤、匯入、探索頁、批次操作都走這支。後端把綁在封存 repo 上的規則
      // 當成不存在：規則清單留著舊資料的話，切換、編輯、刪除那條規則都會 404
      const { actions, rulesInvalidated } = renderWithClient();

      act(() => actions().invalidateRepos());

      expect(rulesInvalidated()).toBe(true);
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

describe("WatchlistContext background star sync", () => {
  it("watches for star syncs that finish in the background", async () => {
    // sidecar 啟動時與 launchd 收集器的同步不會通知前端：Provider 掛著就要開始看最後同步時間
    renderCtx();

    await waitFor(() => expect(mockGetSyncStatus).toHaveBeenCalled());
  });
});

describe("WatchlistContext category filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("picks a category without waiting for anything", () => {
    // 分類篩選用每個 repo 自己的 category_ids（追蹤清單回傳時就帶著）：選下去就生效。以前另查成員，
    // 那支端點預設只回 100 筆，還得處理載入中先列出全部、載入失敗、換分類時的競態
    const { result } = renderCtx();

    act(() => result.current.actions.setCategory(5));

    expect(result.current.state.filters.selectedCategoryId).toBe(5);
  });
});
