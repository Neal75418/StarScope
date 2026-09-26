/**
 * 封存清單。
 *
 * 兩個動作的可逆性天差地遠：重新追蹤只是清掉標記，永久刪除會連快照、訊號與
 * 警示規則一起 cascade 掉。所以刪除必須二次確認，而且確認文案要講清楚會失去什麼
 * ——尤其是警示規則，那是使用者最不會預期被一併刪掉的東西。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ArchivedRepos } from "../ArchivedRepos";
import * as client from "../../../api/client";

vi.mock("../../../api/client");

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
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
});
