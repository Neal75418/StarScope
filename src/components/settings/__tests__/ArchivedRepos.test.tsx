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

  it("names alert rules in the confirmation", async () => {
    // 快照與訊號使用者猜得到，警示規則猜不到——那是他自己設定的東西
    renderWithClient(<ArchivedRepos />);
    fireEvent.click(await screen.findByTestId("archived-delete-7"));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent ?? "").toMatch(/警示規則|alert rule/i);
  });

  it("shows an empty state when nothing is archived", async () => {
    vi.mocked(client.getArchivedRepos).mockResolvedValue({ repos: [], total: 0 });
    renderWithClient(<ArchivedRepos />);

    expect(await screen.findByTestId("archived-empty")).toBeInTheDocument();
  });
});
