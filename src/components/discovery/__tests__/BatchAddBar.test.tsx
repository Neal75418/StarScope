/**
 * 批次加入的三個失敗分支（部分成功、全部失敗、API 例外）先前只在 Trends 的
 * TrendsBatchAddBar 測過；那個殼拆掉後邏輯還活在這裡，測試跟著搬過來。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { userEvent } from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../../lib/react-query";
import { BatchAddBar } from "../BatchAddBar";
import { ToastProvider } from "../../Toast";

const mockBatchAddRepos = vi.fn();
vi.mock("../../../api/client", () => ({
  batchAddRepos: (...args: unknown[]) => mockBatchAddRepos(...args),
}));

const repos = [
  { owner: "a", name: "b" },
  { owner: "c", name: "d" },
];

function renderBar(props: Partial<React.ComponentProps<typeof BatchAddBar>> = {}) {
  const ui: ReactElement = (
    <BatchAddBar selectedRepos={repos} selectedCount={repos.length} onDone={vi.fn()} {...props} />
  );
  // 用真的 ToastProvider：mock 掉 useToast 只能驗「有呼叫」，看不出訊息有沒有出現在畫面上
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>
  );
}

/** 畫面上某一類 toast 的文字；沒有這類 toast 時是空陣列。 */
function shownToasts(type: "success" | "warning" | "error"): string[] {
  return [...document.querySelectorAll(`.toast-${type} .toast-message`)].map(
    (el) => el.textContent ?? ""
  );
}

describe("BatchAddBar", () => {
  beforeEach(() => {
    mockBatchAddRepos.mockReset();
  });

  it("renders nothing when nothing is selected", () => {
    const { container } = renderBar({ selectedRepos: [], selectedCount: 0 });
    expect(container.firstChild).toBeNull();
  });

  it("shows the count and the add button", () => {
    renderBar();
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add 2 to Watchlist" })).toBeInTheDocument();
  });

  it("all succeed: success toast and leaves selection mode", async () => {
    const onDone = vi.fn();
    mockBatchAddRepos.mockResolvedValue({ success: 2, failed: 0, total: 2 });
    renderBar({ onDone });

    await userEvent.setup().click(screen.getByRole("button", { name: "Add 2 to Watchlist" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockBatchAddRepos).toHaveBeenCalledWith(repos);
    expect(shownToasts("success")).toEqual(["Added 2/2 repositories"]);
    expect(shownToasts("warning")).toEqual([]);
    expect(shownToasts("error")).toEqual([]);
  });

  it("some fail: warning toast with the count, stays in selection mode for retry", async () => {
    const onDone = vi.fn();
    mockBatchAddRepos.mockResolvedValue({ success: 1, failed: 1, total: 2 });
    renderBar({ onDone });

    await userEvent.setup().click(screen.getByRole("button", { name: "Add 2 to Watchlist" }));

    await waitFor(() => expect(shownToasts("warning")).toEqual(["Added 1/2 repositories"]));
    expect(onDone).not.toHaveBeenCalled();
    expect(shownToasts("success")).toEqual([]);
  });

  it("all fail: error toast, stays in selection mode", async () => {
    const onDone = vi.fn();
    mockBatchAddRepos.mockResolvedValue({ success: 0, failed: 2, total: 2 });
    renderBar({ onDone });

    await userEvent.setup().click(screen.getByRole("button", { name: "Add 2 to Watchlist" }));

    await waitFor(() => expect(shownToasts("error")).toHaveLength(1));
    expect(onDone).not.toHaveBeenCalled();
    expect(shownToasts("success")).toEqual([]);
    expect(shownToasts("warning")).toEqual([]);
  });

  it("API throws: error toast, stays in selection mode, button re-enabled", async () => {
    const onDone = vi.fn();
    mockBatchAddRepos.mockRejectedValue(new Error("Network error"));
    renderBar({ onDone });

    await userEvent.setup().click(screen.getByRole("button", { name: "Add 2 to Watchlist" }));

    await waitFor(() => expect(shownToasts("error")).toHaveLength(1));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add 2 to Watchlist" })).toBeEnabled();
  });

  it("disables the button and shows progress while adding", async () => {
    mockBatchAddRepos.mockReturnValue(new Promise(() => {})); // never resolves
    renderBar();

    await userEvent.setup().click(screen.getByRole("button", { name: "Add 2 to Watchlist" }));

    expect(screen.getByRole("button", { name: "Adding..." })).toBeDisabled();
  });
});
