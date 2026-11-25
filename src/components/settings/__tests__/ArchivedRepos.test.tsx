/**
 * 封存清單。
 *
 * 兩個動作的可逆性天差地遠：重新追蹤只是清掉標記，永久刪除會連快照、訊號與
 * 警示規則一起 cascade 掉。所以刪除必須二次確認，而且確認文案要講清楚會失去什麼
 * ——尤其是警示規則，那是使用者最不會預期被一併刪掉的東西。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ArchivedRepos } from "../ArchivedRepos";
import * as client from "../../../api/client";
import { queryKeys } from "../../../lib/react-query";
import { DATA_RESET_EVENT } from "../../../constants/events";

vi.mock("../../../api/client");

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>), qc };
}

const ROW = {
  id: 7,
  owner: "a",
  name: "one",
  full_name: "a/one",
  url: "https://github.com/a/one",
  description: null,
  language: "Rust",
  added_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  stars: 120,
  forks: 3,
  stars_delta_1d: null,
  stars_delta_7d: null,
  stars_delta_30d: null,
  velocity: null,
  acceleration: null,
  trend: null,
  forks_delta_7d: null,
  forks_delta_30d: null,
  issues_delta_7d: null,
  issues_delta_30d: null,
  last_fetched: null,
  category_ids: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getArchivedRepos).mockResolvedValue({ repos: [ROW], total: 1 });
  vi.mocked(client.restarRepo).mockResolvedValue(undefined);
  vi.mocked(client.deleteArchivedRepo).mockResolvedValue(undefined);
});

describe("ArchivedRepos", () => {
  it("lists archived repos", async () => {
    renderWithClient(<ArchivedRepos />);
    expect(await screen.findByText("a/one")).toBeInTheDocument();
  });

  it("restores without asking — nothing is lost", async () => {
    renderWithClient(<ArchivedRepos />);
    fireEvent.click(await screen.findByTestId("archived-restar-7"));

    await waitFor(() => expect(client.restarRepo).toHaveBeenCalledWith(7));
  });

  it("refreshes the alert rule list after a restore — rules on that repo come back with it", async () => {
    // 規則清單就在同一頁下方：不重取的話要離開設定頁、等 5 分鐘才會出現
    const { qc } = renderWithClient(<ArchivedRepos />);
    qc.setQueryData(queryKeys.alertRuleData.rules(), []);

    fireEvent.click(await screen.findByTestId("archived-restar-7"));

    await waitFor(() =>
      expect(qc.getQueryState(queryKeys.alertRuleData.rules())?.isInvalidated).toBe(true)
    );
  });

  it("does not delete until the confirmation is accepted", async () => {
    renderWithClient(<ArchivedRepos />);
    fireEvent.click(await screen.findByTestId("archived-delete-7"));

    expect(client.deleteArchivedRepo).not.toHaveBeenCalled();

    // 列上的按鈕與確認鈕同名，必須限定在 dialog 範圍內找
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /永久刪除|Delete permanently/i }));
    await waitFor(() => expect(client.deleteArchivedRepo).toHaveBeenCalledWith(7));
  });

  it("says so when a restore fails instead of just re-enabling the button", async () => {
    // 寫入在 sidecar 連不上時立刻失敗（react-query 的 mutations.networkMode）：沒有提示的話，
    // 使用者看到的只是按鈕轉了一下又恢復
    vi.mocked(client.restarRepo).mockRejectedValue(new Error("Network error: Load failed"));
    renderWithClient(<ArchivedRepos />);
    fireEvent.click(await screen.findByTestId("archived-restar-7"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("closes the confirmation and says so when a delete fails", async () => {
    // 錯誤寫在區塊裡：對話框留著的話會蓋住它
    vi.mocked(client.deleteArchivedRepo).mockRejectedValue(new Error("Network error: Load failed"));
    renderWithClient(<ArchivedRepos />);
    fireEvent.click(await screen.findByTestId("archived-delete-7"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /永久刪除|Delete permanently/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("drops an earlier restore failure when a delete starts", async () => {
    // 只留最近一次操作的錯誤：復原失敗後開始刪除，畫面上不能還掛著「沒有完成」
    vi.mocked(client.restarRepo).mockRejectedValue(new Error("Network error: Load failed"));
    renderWithClient(<ArchivedRepos />);
    fireEvent.click(await screen.findByTestId("archived-restar-7"));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByTestId("archived-delete-7"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /永久刪除|Delete permanently/i }));

    await waitFor(() => expect(client.deleteArchivedRepo).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("drops an earlier delete failure when a restore starts", async () => {
    vi.mocked(client.deleteArchivedRepo).mockRejectedValue(new Error("Network error: Load failed"));
    renderWithClient(<ArchivedRepos />);
    fireEvent.click(await screen.findByTestId("archived-delete-7"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /永久刪除|Delete permanently/i }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByTestId("archived-restar-7"));

    await waitFor(() => expect(client.restarRepo).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("still reports a restore that fails after a delete was started meanwhile", async () => {
    // 請求還在跑時 reset() 會把 hook 從那次請求上拆下來：按鈕馬上又能按、之後失敗也不會說
    const OTHER = {
      ...ROW,
      id: 8,
      name: "two",
      full_name: "a/two",
      url: "https://github.com/a/two",
    };
    vi.mocked(client.getArchivedRepos).mockResolvedValue({ repos: [ROW, OTHER], total: 2 });
    let failRestore: (reason: Error) => void = () => {};
    vi.mocked(client.restarRepo).mockReturnValue(
      new Promise((_, reject) => {
        failRestore = reject;
      })
    );
    renderWithClient(<ArchivedRepos />);
    fireEvent.click(await screen.findByTestId("archived-restar-7"));

    fireEvent.click(screen.getByTestId("archived-delete-8"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /永久刪除|Delete permanently/i }));
    await waitFor(() => expect(client.deleteArchivedRepo).toHaveBeenCalledWith(8));

    expect(screen.getByTestId("archived-restar-7")).toBeDisabled(); // 復原還在跑
    failRestore(new Error("Network error: Load failed"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  describe("when the other action has just finished but the screen has not caught up", () => {
    // React Query 以 setTimeout(0) 才通知畫面：這時渲染出來的 isPending 還是 true，要看 mutation cache 才知道它已經結束。
    // cache 在 dispatch 時同步通知 listener：await 回來時畫面還沒收到通知
    const failedInCache = (qc: QueryClient, action: "restar" | "purge") =>
      new Promise<void>((resolve) => {
        const unsubscribe = qc.getMutationCache().subscribe((event) => {
          const [area, name] = event.mutation?.options.mutationKey ?? [];
          if (
            event.type === "updated" &&
            event.action.type === "error" &&
            area === "archivedRepos" &&
            name === action
          ) {
            unsubscribe();
            resolve();
          }
        });
      });

    it("drops a restore failure when a delete is confirmed", async () => {
      let failRestore: (reason: Error) => void = () => {};
      vi.mocked(client.restarRepo).mockReturnValue(
        new Promise((_, reject) => {
          failRestore = reject;
        })
      );
      const { qc } = renderWithClient(<ArchivedRepos />);
      fireEvent.click(await screen.findByTestId("archived-restar-7"));
      await waitFor(() => expect(client.restarRepo).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByTestId("archived-delete-7"));
      const dialog = await screen.findByRole("alertdialog");
      const confirm = within(dialog).getByRole("button", { name: /永久刪除|Delete permanently/i });

      const failed = failedInCache(qc, "restar");
      failRestore(new Error("Network error: Load failed"));
      await failed;
      // 前提：復原已經結束（快取不算它在跑），畫面還沒收到通知
      expect(qc.isMutating({ mutationKey: ["archivedRepos", "restar"] })).toBe(0);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      fireEvent.click(confirm);
      await waitFor(() => expect(client.deleteArchivedRepo).toHaveBeenCalledWith(7));
      await act(() => new Promise((r) => setTimeout(r, 50)));

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("drops a delete failure when a restore starts", async () => {
      let failDelete: (reason: Error) => void = () => {};
      vi.mocked(client.deleteArchivedRepo).mockReturnValue(
        new Promise((_, reject) => {
          failDelete = reject;
        })
      );
      const { qc } = renderWithClient(<ArchivedRepos />);
      fireEvent.click(await screen.findByTestId("archived-delete-7"));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /永久刪除|Delete permanently/i }));
      await waitFor(() => expect(client.deleteArchivedRepo).toHaveBeenCalledTimes(1));

      // 刪除失敗時 onError 會關確認框（setState 不在 act 裡，會印一次警告）：包進 act 的話畫面先更新，前提就不成立了
      const failed = failedInCache(qc, "purge");
      failDelete(new Error("Network error: Load failed"));
      await failed;
      expect(qc.isMutating({ mutationKey: ["archivedRepos", "purge"] })).toBe(0);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("archived-restar-7"));
      await waitFor(() => expect(client.restarRepo).toHaveBeenCalledWith(7));
      await act(() => new Promise((r) => setTimeout(r, 50)));

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("after leaving the page while an earlier restore is still running", () => {
    // 離開設定頁時元件卸載，舊實例的請求還在 mutation cache 裡跑；回來的新實例只能看自己的請求
    const OTHER = {
      ...ROW,
      id: 8,
      name: "two",
      full_name: "a/two",
      url: "https://github.com/a/two",
    };
    const settle = () => act(() => new Promise((r) => setTimeout(r, 50)));

    async function comeBackWhileRestoreRuns() {
      vi.mocked(client.getArchivedRepos).mockResolvedValue({ repos: [ROW, OTHER], total: 2 });
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      vi.mocked(client.restarRepo).mockReturnValueOnce(new Promise(() => {}));
      const first = render(
        <QueryClientProvider client={qc}>
          <ArchivedRepos />
        </QueryClientProvider>
      );
      fireEvent.click(await screen.findByTestId("archived-restar-7"));
      await waitFor(() => expect(client.restarRepo).toHaveBeenCalledTimes(1));
      first.unmount();
      expect(qc.isMutating({ mutationKey: ["archivedRepos", "restar"] })).toBe(1);
      render(
        <QueryClientProvider client={qc}>
          <ArchivedRepos />
        </QueryClientProvider>
      );
      return qc;
    }

    it("drops this page's restore failure when a delete is confirmed", async () => {
      await comeBackWhileRestoreRuns();
      vi.mocked(client.restarRepo).mockRejectedValueOnce(new Error("Network error: Load failed"));
      fireEvent.click(await screen.findByTestId("archived-restar-8"));
      await screen.findByRole("alert");

      fireEvent.click(screen.getByTestId("archived-delete-8"));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /永久刪除|Delete permanently/i }));
      await waitFor(() => expect(client.deleteArchivedRepo).toHaveBeenCalledWith(8));
      await settle();

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("drops this page's delete failure when a restore starts", async () => {
      await comeBackWhileRestoreRuns();
      vi.mocked(client.deleteArchivedRepo).mockRejectedValueOnce(
        new Error("Network error: Load failed")
      );
      fireEvent.click(await screen.findByTestId("archived-delete-8"));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /永久刪除|Delete permanently/i }));
      await screen.findByRole("alert");

      fireEvent.click(screen.getByTestId("archived-restar-8"));
      await waitFor(() => expect(client.restarRepo).toHaveBeenCalledTimes(2));
      await settle();

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("drops this page's restore failure when all data is reset", async () => {
      await comeBackWhileRestoreRuns();
      vi.mocked(client.restarRepo).mockRejectedValueOnce(new Error("Network error: Load failed"));
      fireEvent.click(await screen.findByTestId("archived-restar-8"));
      await screen.findByRole("alert");

      act(() => {
        window.dispatchEvent(new Event(DATA_RESET_EVENT));
      });
      await settle();

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("after all data is reset", () => {
    // 重設會刪掉所有 repo、封存清單重讀成空：上一次操作的錯誤講的是已經不在的 repo
    const resetAllData = () =>
      act(() => {
        window.dispatchEvent(new Event(DATA_RESET_EVENT));
      });
    const confirmDelete = async () => {
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /永久刪除|Delete permanently/i }));
    };

    it("drops a restore failure", async () => {
      vi.mocked(client.restarRepo).mockRejectedValue(new Error("Network error: Load failed"));
      renderWithClient(<ArchivedRepos />);
      fireEvent.click(await screen.findByTestId("archived-restar-7"));
      await screen.findByRole("alert");

      resetAllData();

      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });

    it("drops a delete failure", async () => {
      vi.mocked(client.deleteArchivedRepo).mockRejectedValue(
        new Error("Network error: Load failed")
      );
      renderWithClient(<ArchivedRepos />);
      fireEvent.click(await screen.findByTestId("archived-delete-7"));
      await confirmDelete();
      await screen.findByRole("alert");

      resetAllData();

      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });

    /** app 別處還有寫入在跑（例如同一頁的星標同步，最長 120 秒）：只看這兩個動作自己的 key，不能因此留著錯誤 */
    const startAnotherWrite = (qc: QueryClient) => {
      void qc
        .getMutationCache()
        .build(qc, { mutationKey: ["starSync", "sync"], mutationFn: () => new Promise(() => {}) })
        .execute(undefined);
    };

    it("drops a restore failure while another part of the app is still writing", async () => {
      vi.mocked(client.restarRepo).mockRejectedValue(new Error("Network error: Load failed"));
      const { qc } = renderWithClient(<ArchivedRepos />);
      fireEvent.click(await screen.findByTestId("archived-restar-7"));
      await screen.findByRole("alert");
      startAnotherWrite(qc);

      resetAllData();

      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });

    it("drops a delete failure while another part of the app is still writing", async () => {
      vi.mocked(client.deleteArchivedRepo).mockRejectedValue(
        new Error("Network error: Load failed")
      );
      const { qc } = renderWithClient(<ArchivedRepos />);
      fireEvent.click(await screen.findByTestId("archived-delete-7"));
      await confirmDelete();
      await screen.findByRole("alert");
      startAnotherWrite(qc);

      resetAllData();

      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });

    it("still reports a restore that was running when the data was reset", async () => {
      // 還在跑的不能 reset：之後它失敗了也不會說
      let failRestore: (reason: Error) => void = () => {};
      vi.mocked(client.restarRepo).mockReturnValue(
        new Promise((_, reject) => {
          failRestore = reject;
        })
      );
      renderWithClient(<ArchivedRepos />);
      fireEvent.click(await screen.findByTestId("archived-restar-7"));
      await waitFor(() => expect(client.restarRepo).toHaveBeenCalledTimes(1));

      resetAllData();
      failRestore(new Error("Network error: Load failed"));

      expect(await screen.findByRole("alert")).toBeInTheDocument();
    });

    it("still reports a delete that was running when the data was reset", async () => {
      let failDelete: (reason: Error) => void = () => {};
      vi.mocked(client.deleteArchivedRepo).mockReturnValue(
        new Promise((_, reject) => {
          failDelete = reject;
        })
      );
      renderWithClient(<ArchivedRepos />);
      fireEvent.click(await screen.findByTestId("archived-delete-7"));
      await confirmDelete();
      await waitFor(() => expect(client.deleteArchivedRepo).toHaveBeenCalledTimes(1));

      resetAllData();
      failDelete(new Error("Network error: Load failed"));

      expect(await screen.findByRole("alert")).toBeInTheDocument();
    });
  });

  it("names alert rules in the confirmation", async () => {
    // 快照與訊號使用者猜得到，警示規則猜不到——那是他自己設定的東西
    renderWithClient(<ArchivedRepos />);
    fireEvent.click(await screen.findByTestId("archived-delete-7"));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent ?? "").toMatch(/警示規則|alert rule/i);
  });

  it("does not claim the archive is empty before it has loaded", async () => {
    // 「沒有封存」與「還不知道」是兩件事；先講前者會在資料到達前顯示錯的句子
    let resolveIt: (v: { repos: []; total: number }) => void = () => {};
    vi.mocked(client.getArchivedRepos).mockReturnValue(
      new Promise((r) => {
        resolveIt = r;
      })
    );
    renderWithClient(<ArchivedRepos />);

    expect(screen.queryByTestId("archived-empty")).not.toBeInTheDocument();

    resolveIt({ repos: [], total: 0 });
    expect(await screen.findByTestId("archived-empty")).toBeInTheDocument();
  });

  it("shows an empty state when nothing is archived", async () => {
    vi.mocked(client.getArchivedRepos).mockResolvedValue({ repos: [], total: 0 });
    renderWithClient(<ArchivedRepos />);

    expect(await screen.findByTestId("archived-empty")).toBeInTheDocument();
  });

  it("says the list failed to load instead of claiming the archive is empty", async () => {
    // 「沒有封存」與「讀不到」是兩件事：讀不到時說沒有，使用者會以為封存的專案不見了
    vi.mocked(client.getArchivedRepos).mockRejectedValue(new Error("boom"));
    renderWithClient(<ArchivedRepos />);

    const section = screen.getByTestId("archived-repos");
    expect(await screen.findByTestId("archived-load-error")).toHaveTextContent(
      "Couldn't load the archived list."
    );
    expect(screen.queryByTestId("archived-empty")).not.toBeInTheDocument();
    // 也不留著載入中的骨架：讀取已經有結果了（失敗），不是還在讀
    expect(section.querySelector(".skeleton")).toBeNull();
  });

  it("loads the list again when retry is pressed after a failed load", async () => {
    vi.mocked(client.getArchivedRepos).mockRejectedValueOnce(new Error("boom"));
    renderWithClient(<ArchivedRepos />);
    const error = await screen.findByTestId("archived-load-error");

    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("a/one")).toBeInTheDocument();
    expect(screen.queryByTestId("archived-load-error")).not.toBeInTheDocument();
  });

  it("keeps the list on screen and says so when a later reload fails", async () => {
    // 復原或刪除之後重讀失敗時，畫面上的清單是舊的（剛刪掉的那筆可能還在）
    const { qc } = renderWithClient(<ArchivedRepos />);
    expect(await screen.findByText("a/one")).toBeInTheDocument();

    vi.mocked(client.getArchivedRepos).mockRejectedValue(new Error("boom"));
    void qc.invalidateQueries({ queryKey: queryKeys.repos.archived() });

    expect(await screen.findByTestId("archived-load-error")).toBeInTheDocument();
    expect(screen.getByText("a/one")).toBeInTheDocument();
  });

  it("does not claim the archive is empty when the last read was empty and a reload fails", async () => {
    // 上一次讀到的是空清單，不代表現在還是空的
    vi.mocked(client.getArchivedRepos).mockResolvedValue({ repos: [], total: 0 });
    const { qc } = renderWithClient(<ArchivedRepos />);
    expect(await screen.findByTestId("archived-empty")).toBeInTheDocument();

    vi.mocked(client.getArchivedRepos).mockRejectedValue(new Error("boom"));
    void qc.invalidateQueries({ queryKey: queryKeys.repos.archived() });

    expect(await screen.findByTestId("archived-load-error")).toBeInTheDocument();
    expect(screen.queryByTestId("archived-empty")).not.toBeInTheDocument();
  });

  it("does not claim the archive is empty while the query is paused", async () => {
    // 連上過 sidecar 之後又斷線：查詢是暫停的（isLoading 為 false），還不知道有沒有封存
    onlineManager.setOnline(false);
    try {
      renderWithClient(<ArchivedRepos />);
      // 等一拍：React Query 以 setTimeout(0) 才通知元件，馬上斷言「沒出現」會空過
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

      expect(client.getArchivedRepos).not.toHaveBeenCalled();
      expect(screen.getByTestId("archived-repos").querySelector(".skeleton")).not.toBeNull();
      expect(screen.queryByTestId("archived-empty")).not.toBeInTheDocument();
      expect(screen.queryByTestId("archived-load-error")).not.toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("shows the retry as running when it is pressed while the connection is down", async () => {
    // 斷線時按重試，讀取只能暫停、等連上才接著讀：按鈕看起來還能按的話，再按也不會有任何反應
    vi.mocked(client.getArchivedRepos).mockRejectedValueOnce(new Error("boom"));
    renderWithClient(<ArchivedRepos />);
    const error = await screen.findByTestId("archived-load-error");
    onlineManager.setOnline(false);
    try {
      fireEvent.click(within(error).getByRole("button", { name: "Retry" }));

      expect(await within(error).findByRole("button", { name: "Retrying…" })).toBeInTheDocument();
      expect(client.getArchivedRepos).toHaveBeenCalledTimes(1);
    } finally {
      onlineManager.setOnline(true);
    }
    // 連上之後自己接著讀
    expect(await screen.findByText("a/one")).toBeInTheDocument();
  });

  it("keeps the error and its retry button in place while the retry is running", async () => {
    // 重試一開始 React Query 就把 error 清掉：錯誤訊息跟著消失的話，焦點會離開重試鈕（掉到 body）
    vi.mocked(client.getArchivedRepos).mockRejectedValueOnce(new Error("boom"));
    renderWithClient(<ArchivedRepos />);
    const error = await screen.findByTestId("archived-load-error");
    const retry = within(error).getByRole("button", { name: "Retry" });
    let finishRetry: (v: { repos: (typeof ROW)[]; total: number }) => void = () => {};
    vi.mocked(client.getArchivedRepos).mockReturnValue(
      new Promise((resolve) => {
        finishRetry = resolve;
      })
    );
    retry.focus();

    fireEvent.click(retry);

    expect(await within(error).findByRole("button", { name: "Retrying…" })).toBe(retry);
    expect(retry).toHaveFocus();
    expect(screen.queryByTestId("archived-empty")).not.toBeInTheDocument();

    finishRetry({ repos: [ROW], total: 1 });
    expect(await screen.findByText("a/one")).toBeInTheDocument();
  });
});
