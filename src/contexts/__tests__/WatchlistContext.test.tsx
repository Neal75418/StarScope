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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient, invalidateTrackedRepos, queryKeys } from "../../lib/react-query";
import { ApiError } from "../../api/types";
import { WatchlistProvider, useWatchlistActions, useWatchlistState } from "../WatchlistContext";

const mockAddRepo = vi.fn();
const mockUnstarRepo = vi.fn();
const mockFetchAllRepos = vi.fn();
const mockGetCategoryRepos = vi.fn();

// 只換掉會打網路的那幾支，其餘（尤其 ApiError——client 從 ./types 再匯出它，
// 整包換掉會讓 getErrorMessage 的 instanceof 檢查拿到 undefined）保留真身
vi.mock("../../api/client", async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  addRepo: (...a: unknown[]) => mockAddRepo(...a),
  unstarRepo: (...a: unknown[]) => mockUnstarRepo(...a),
  fetchRepo: vi.fn(() => Promise.resolve()),
  fetchAllRepos: (...a: unknown[]) => mockFetchAllRepos(...a),
  recalculateAllSimilarities: vi.fn(() => Promise.resolve()),
  getCategoryRepos: (...a: unknown[]) => mockGetCategoryRepos(...a),
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
    mockGetCategoryRepos.mockResolvedValue({ repos: [] });
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

describe("WatchlistContext category filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks 不清 mockImplementationOnce 的佇列：某條測試沒用完的會漏到下一條
    mockGetCategoryRepos.mockReset();
  });

  // 要從外面呼叫 invalidateTrackedRepos 的測試用：設定頁、探索頁那些入口只拿得到 QueryClient
  function renderWithClient(client: QueryClient = createTestQueryClient()) {
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <WatchlistProvider>{children}</WatchlistProvider>
      </QueryClientProvider>
    );
    return {
      client,
      ...renderHook(() => ({ actions: useWatchlistActions(), state: useWatchlistState() }), {
        wrapper: Wrapper,
      }),
    };
  }

  const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));

  const loadFailed = expect.objectContaining({
    type: "error",
    message: "Couldn't load that category — showing all repositories",
  });

  it("filters to the category's members once they load", async () => {
    mockGetCategoryRepos.mockResolvedValue({ repos: [{ id: 3 }, { id: 7 }] });
    const { result } = renderCtx();

    act(() => result.current.actions.setCategory(5));

    expect(result.current.state.filters.selectedCategoryId).toBe(5);
    await waitFor(() => expect(result.current.state.filters.categoryRepoIds).toEqual([3, 7]));
  });

  it("drops the selection and says so when the category fails to load", async () => {
    // 以前只把成員設成 null：側欄停在這個分類，清單卻因為 null＝不篩選列出全部 repo，也沒有提示。
    // 一般的 client（預設會重試）：apiCall 已經重試過網路錯誤，查詢再重試只會讓退回晚好幾秒
    mockGetCategoryRepos.mockRejectedValue(new Error("boom"));
    const { result } = renderWithClient(new QueryClient());

    act(() => result.current.actions.setCategory(5));

    await waitFor(() => expect(result.current.state.filters.selectedCategoryId).toBeNull());
    expect(result.current.state.toasts).toEqual([loadFailed]);
    expect(mockGetCategoryRepos).toHaveBeenCalledTimes(1);
  });

  it("follows changes made by anything that refetches the tracked repos", async () => {
    // 設定頁復原、立即同步、探索頁批次加入都只呼叫 invalidateTrackedRepos：成員不跟著重讀的話，
    // 回到 Watchlist 時選著的分類少了剛復原的 repo，要重點一次分類才出現
    mockGetCategoryRepos
      .mockResolvedValueOnce({ repos: [{ id: 3 }] })
      .mockResolvedValueOnce({ repos: [{ id: 3 }, { id: 7 }] });
    const { client, result } = renderWithClient();

    act(() => result.current.actions.setCategory(5));
    await waitFor(() => expect(result.current.state.filters.categoryRepoIds).toEqual([3]));
    act(() => invalidateTrackedRepos(client));

    await waitFor(() => expect(result.current.state.filters.categoryRepoIds).toEqual([3, 7]));
  });

  it("asks for the members once per refetch of the tracked repos", async () => {
    mockGetCategoryRepos.mockResolvedValue({ repos: [{ id: 3 }] });
    const { result } = renderCtx();

    act(() => result.current.actions.setCategory(5));
    await waitFor(() => expect(result.current.state.filters.categoryRepoIds).toEqual([3]));
    act(() => result.current.actions.invalidateRepos());
    await settle();

    expect(mockGetCategoryRepos).toHaveBeenCalledTimes(2);
  });

  it("reloads the members when the selected category is picked again", async () => {
    // 再點一次同一個分類＝重讀：伺服器上的歸屬改了，使用者有辦法手動跟上
    mockGetCategoryRepos
      .mockResolvedValueOnce({ repos: [{ id: 3 }] })
      .mockResolvedValueOnce({ repos: [{ id: 3 }, { id: 7 }] });
    const { result } = renderCtx();

    act(() => result.current.actions.setCategory(5));
    await waitFor(() => expect(result.current.state.filters.categoryRepoIds).toEqual([3]));
    act(() => result.current.actions.setCategory(5));

    await waitFor(() => expect(result.current.state.filters.categoryRepoIds).toEqual([3, 7]));
  });

  it("cancels the old request when another category is picked", async () => {
    // 慢回應不能寫進新選的分類；被中止的舊請求也不能被當成載入失敗而跳錯誤
    const signals: AbortSignal[] = [];
    mockGetCategoryRepos
      .mockImplementationOnce((_id: number, signal: AbortSignal) => {
        signals.push(signal);
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      })
      .mockResolvedValueOnce({ repos: [{ id: 9 }] });
    const { result } = renderCtx();

    act(() => result.current.actions.setCategory(5));
    await waitFor(() => expect(mockGetCategoryRepos).toHaveBeenCalledTimes(1));
    act(() => result.current.actions.setCategory(7));

    await waitFor(() => expect(result.current.state.filters.categoryRepoIds).toEqual([9]));
    expect(signals[0].aborted).toBe(true);
    expect(result.current.state.filters.selectedCategoryId).toBe(7);
    expect(result.current.state.toasts).toEqual([]);
  });

  it("keeps the loaded members when a later refresh fails", async () => {
    // 有成員時清單仍照這個分類篩選，只是可能稍舊——不必把使用者踢回「全部」
    mockGetCategoryRepos
      .mockResolvedValueOnce({ repos: [{ id: 3 }, { id: 7 }] })
      .mockRejectedValueOnce(new Error("boom"));
    const { result } = renderCtx();

    act(() => result.current.actions.setCategory(5));
    await waitFor(() => expect(result.current.state.filters.categoryRepoIds).toEqual([3, 7]));
    act(() => result.current.actions.invalidateRepos());
    await waitFor(() => expect(mockGetCategoryRepos).toHaveBeenCalledTimes(2));
    await settle();

    expect(result.current.state.filters.selectedCategoryId).toBe(5);
    expect(result.current.state.filters.categoryRepoIds).toEqual([3, 7]);
    expect(result.current.state.toasts).toEqual([]);
  });

  it("picks up a write that lands while the category is still loading", async () => {
    // 第一次載入的請求是寫入前讀的：重讀若只是併進它，清單會停在舊成員，要再點一次分類才更新
    let resolveFirst: (v: { repos: { id: number }[] }) => void = () => {};
    mockGetCategoryRepos
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({ repos: [{ id: 3 }, { id: 7 }] });
    const { client, result } = renderWithClient();

    act(() => result.current.actions.setCategory(5));
    await waitFor(() => expect(mockGetCategoryRepos).toHaveBeenCalledTimes(1));
    act(() => invalidateTrackedRepos(client));
    act(() => resolveFirst({ repos: [{ id: 3 }] }));

    await waitFor(() => expect(result.current.state.filters.categoryRepoIds).toEqual([3, 7]));
    await settle();
    expect(result.current.state.filters.categoryRepoIds).toEqual([3, 7]);
    expect(mockGetCategoryRepos).toHaveBeenCalledTimes(2);
  });

  it("falls back once when the load restarted by a refresh fails", async () => {
    // 被中止的第一次載入不算失敗；重新發出的那次失敗時只退回一次、只跳一個錯誤
    mockGetCategoryRepos
      .mockImplementationOnce(
        (_id: number, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError"))
            );
          })
      )
      .mockRejectedValueOnce(new Error("boom"));
    const { client, result } = renderWithClient();

    act(() => result.current.actions.setCategory(5));
    await waitFor(() => expect(mockGetCategoryRepos).toHaveBeenCalledTimes(1));
    act(() => invalidateTrackedRepos(client));

    await waitFor(() => expect(result.current.state.filters.selectedCategoryId).toBeNull());
    await settle();
    expect(result.current.state.toasts).toEqual([loadFailed]);
    expect(mockGetCategoryRepos).toHaveBeenCalledTimes(2);
  });

  it("reloads a category it has shown before when the user comes back to it", async () => {
    // 正式版 5 分鐘內視為新鮮：不主動重讀的話，回到看過的分類只會看到上次的快取
    mockGetCategoryRepos.mockImplementation((id: number) =>
      Promise.resolve({ repos: id === 5 ? [{ id: 3 }] : [{ id: 9 }] })
    );
    const { result } = renderWithClient(
      new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } })
    );

    act(() => result.current.actions.setCategory(5));
    await waitFor(() => expect(result.current.state.filters.categoryRepoIds).toEqual([3]));
    act(() => result.current.actions.setCategory(7));
    await waitFor(() => expect(result.current.state.filters.categoryRepoIds).toEqual([9]));
    mockGetCategoryRepos.mockImplementation((id: number) =>
      Promise.resolve({ repos: id === 5 ? [{ id: 3 }, { id: 7 }] : [{ id: 9 }] })
    );
    act(() => result.current.actions.setCategory(5));

    await waitFor(() => expect(result.current.state.filters.categoryRepoIds).toEqual([3, 7]));
  });

  it("retries a category that failed before instead of failing again right away", async () => {
    // 失敗的查詢會帶著錯誤留在快取裡（正式版 gcTime 30 分鐘；測試用 client 是 0，要用一般的）：
    // 再點同一個分類必須真的重讀，而不是一掛上去就看到舊的錯誤、又被踢回「全部」
    mockGetCategoryRepos
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ repos: [{ id: 3 }] });
    const { result } = renderWithClient(
      new QueryClient({ defaultOptions: { queries: { retry: false } } })
    );

    act(() => result.current.actions.setCategory(5));
    await waitFor(() => expect(result.current.state.filters.selectedCategoryId).toBeNull());
    act(() => result.current.actions.setCategory(5));

    await waitFor(() => expect(result.current.state.filters.categoryRepoIds).toEqual([3]));
    expect(result.current.state.filters.selectedCategoryId).toBe(5);
    expect(result.current.state.toasts).toEqual([loadFailed]);
  });
});
