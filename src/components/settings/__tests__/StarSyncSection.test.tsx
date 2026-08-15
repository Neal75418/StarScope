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
