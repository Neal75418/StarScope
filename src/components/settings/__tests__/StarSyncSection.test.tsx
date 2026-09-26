/**
 * Star 同步設定區塊。
 *
 * 重點在「什麼都沒發生」也要說得出原因：同步在沒有 token、取得失敗、回傳 0 筆、
 * 或已有一輪在跑時都會刻意不做任何移除。這些情況下只顯示「完成」會讓使用者
 * 以為 GitHub 上真的沒有變動。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { StarSyncSection } from "../StarSyncSection";
import * as client from "../../../api/client";

vi.mock("../../../api/client");

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const NOTHING: client.SyncResult = {
  added: 0,
  restored: 0,
  renamed: 0,
  archived: 0,
  skipped_reason: null,
  pending_local_only: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getSyncStatus).mockResolvedValue({
    last_sync_at: "2026-08-16T01:00:00Z",
    running: false,
  });
});

describe("StarSyncSection", () => {
  it("reports what the sync changed", async () => {
    vi.mocked(client.syncStars).mockResolvedValue({ ...NOTHING, added: 93, archived: 2 });
    renderWithClient(<StarSyncSection />);

    fireEvent.click(await screen.findByTestId("star-sync-btn"));

    const result = await screen.findByTestId("star-sync-result");
    expect(result).toHaveTextContent("93");
    expect(result).toHaveTextContent("2");
  });

  it("says why nothing happened instead of showing a silent success", async () => {
    vi.mocked(client.syncStars).mockResolvedValue({
      ...NOTHING,
      skipped_reason: "empty_response",
    });
    renderWithClient(<StarSyncSection />);

    fireEvent.click(await screen.findByTestId("star-sync-btn"));

    expect(await screen.findByTestId("star-sync-skipped")).toBeInTheDocument();
    expect(screen.queryByTestId("star-sync-result")).not.toBeInTheDocument();
  });

  it("後端會產生的每個 skipped_reason 都有對應文案（新 reason 不得塌回計數顯示）", async () => {
    // race_lost 曾漏掉：後端建立了可區分狀態，前端查無 key 就靜默顯示
    // 「新增 0 · 復原 0 …」——正是這個元件 docstring 說要消滅的平靜假象
    const backendReasons = [
      "no_token",
      "already_running",
      "fetch_failed",
      "empty_response",
      "race_lost",
    ];
    for (const reason of backendReasons) {
      vi.mocked(client.syncStars).mockResolvedValue({ ...NOTHING, skipped_reason: reason });
      const { unmount } = renderWithClient(<StarSyncSection />);

      fireEvent.click(await screen.findByTestId("star-sync-btn"));

      expect(await screen.findByTestId("star-sync-skipped")).toBeInTheDocument();
      expect(screen.queryByTestId("star-sync-result")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("lists the repos a first sync could not decide about", async () => {
    vi.mocked(client.syncStars).mockResolvedValue({
      ...NOTHING,
      added: 5,
      pending_local_only: ["a/one", "b/two"],
    });
    renderWithClient(<StarSyncSection />);

    fireEvent.click(await screen.findByTestId("star-sync-btn"));

    const pending = await screen.findByTestId("star-sync-pending");
    expect(pending).toHaveTextContent("a/one");
    expect(pending).toHaveTextContent("b/two");
  });

  it("offers a way out of the first sync's pending list", async () => {
    // 只顯示清單而沒有動作，等於讓使用者看到問題卻無從處理
    vi.mocked(client.syncStars).mockResolvedValue({
      ...NOTHING,
      pending_local_only: ["a/one"],
    });
    vi.mocked(client.resolveLocalOnly).mockResolvedValue({ handled: 1 });
    renderWithClient(<StarSyncSection />);
    fireEvent.click(await screen.findByTestId("star-sync-btn"));

    fireEvent.click(await screen.findByTestId("star-sync-pending-star"));

    await waitFor(() => expect(client.resolveLocalOnly).toHaveBeenCalledWith("star", ["a/one"]));
  });

  it("surfaces a failed pending-list action instead of leaving the button silent", async () => {
    vi.mocked(client.syncStars).mockResolvedValue({ ...NOTHING, pending_local_only: ["a/one"] });
    vi.mocked(client.resolveLocalOnly).mockRejectedValue(new Error("sidecar down"));
    renderWithClient(<StarSyncSection />);
    fireEvent.click(await screen.findByTestId("star-sync-btn"));

    fireEvent.click(await screen.findByTestId("star-sync-pending-star"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("drops a failed pending-list action when a later sync starts", async () => {
    vi.mocked(client.syncStars).mockResolvedValue({ ...NOTHING, pending_local_only: ["a/one"] });
    vi.mocked(client.resolveLocalOnly).mockRejectedValue(new Error("sidecar down"));
    renderWithClient(<StarSyncSection />);
    fireEvent.click(await screen.findByTestId("star-sync-btn"));
    fireEvent.click(await screen.findByTestId("star-sync-pending-star"));
    await screen.findByRole("alert");

    vi.mocked(client.syncStars).mockResolvedValue({ ...NOTHING, added: 1 });
    fireEvent.click(screen.getByTestId("star-sync-btn"));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("still reports a pending-list action that fails after a sync was started meanwhile", async () => {
    // 同步鈕在清單動作進行中仍可按：這時不能 reset 那個還在跑的動作，否則它失敗了也不會說
    vi.mocked(client.syncStars).mockResolvedValue({ ...NOTHING, pending_local_only: ["a/one"] });
    let failResolve: (reason: Error) => void = () => {};
    vi.mocked(client.resolveLocalOnly).mockReturnValue(
      new Promise((_, reject) => {
        failResolve = reject;
      })
    );
    renderWithClient(<StarSyncSection />);
    fireEvent.click(await screen.findByTestId("star-sync-btn"));
    // 兩次點擊之間不等重新渲染：React Query 以 setTimeout(0) 才通知畫面，主執行緒忙的時候
    // 第二次點擊可能搶在前面，判斷「還在跑」不能靠渲染當下的 isPending
    fireEvent.click(await screen.findByTestId("star-sync-pending-star"));
    fireEvent.click(screen.getByTestId("star-sync-btn"));
    await waitFor(() => expect(client.syncStars).toHaveBeenCalledTimes(2));
    failResolve(new Error("sidecar down"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("still reports a sync that fails after a pending-list action finished meanwhile", async () => {
    // 清單動作成功時會清掉同步的結果；同步還在跑就不能清，否則它失敗了也不會說
    vi.mocked(client.syncStars).mockResolvedValueOnce({
      ...NOTHING,
      pending_local_only: ["a/one"],
    });
    let finishResolve: () => void = () => {};
    vi.mocked(client.resolveLocalOnly).mockReturnValue(
      new Promise((resolve) => {
        finishResolve = () => resolve({ handled: 1 });
      })
    );
    let failSync: (reason: Error) => void = () => {};
    renderWithClient(<StarSyncSection />);
    fireEvent.click(await screen.findByTestId("star-sync-btn"));
    fireEvent.click(await screen.findByTestId("star-sync-pending-star"));

    vi.mocked(client.syncStars).mockReturnValueOnce(
      new Promise((_, reject) => {
        failSync = reject;
      })
    );
    fireEvent.click(screen.getByTestId("star-sync-btn"));
    await waitFor(() => expect(client.syncStars).toHaveBeenCalledTimes(2));
    finishResolve();
    await waitFor(() => expect(client.resolveLocalOnly).toHaveBeenCalledTimes(1));
    failSync(new Error("sidecar down"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("does not claim it has never synced before the status arrives", async () => {
    vi.mocked(client.getSyncStatus).mockReturnValue(new Promise(() => {}));
    renderWithClient(<StarSyncSection />);

    await screen.findByTestId("star-sync-btn");
    expect(screen.queryByTestId("star-sync-stamp")).not.toBeInTheDocument();
  });

  it("surfaces a failed sync instead of leaving the button silent", async () => {
    vi.mocked(client.syncStars).mockRejectedValue(new Error("sidecar down"));
    renderWithClient(<StarSyncSection />);

    fireEvent.click(await screen.findByTestId("star-sync-btn"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
