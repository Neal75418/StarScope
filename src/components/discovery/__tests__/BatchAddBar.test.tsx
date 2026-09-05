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

const mockBatchAddRepos = vi.fn();
vi.mock("../../../api/client", () => ({
  batchAddRepos: (...args: unknown[]) => mockBatchAddRepos(...args),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock("../../Toast", () => ({ useToast: () => toast }));

const repos = [
  { owner: "a", name: "b" },
  { owner: "c", name: "d" },
];

function renderBar(props: Partial<React.ComponentProps<typeof BatchAddBar>> = {}) {
  const ui: ReactElement = (
    <BatchAddBar selectedRepos={repos} selectedCount={repos.length} onDone={vi.fn()} {...props} />
  );
  return render(<QueryClientProvider client={createTestQueryClient()}>{ui}</QueryClientProvider>);
}

describe("BatchAddBar", () => {
  beforeEach(() => {
    mockBatchAddRepos.mockReset();
    toast.success.mockReset();
    toast.warning.mockReset();
    toast.error.mockReset();
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
    expect(toast.success).toHaveBeenCalledWith("Added 2/2 repositories");
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("some fail: warning toast with the count, stays in selection mode for retry", async () => {
    const onDone = vi.fn();
    mockBatchAddRepos.mockResolvedValue({ success: 1, failed: 1, total: 2 });
    renderBar({ onDone });

    await userEvent.setup().click(screen.getByRole("button", { name: "Add 2 to Watchlist" }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("Added 1/2 repositories"));
    expect(onDone).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("all fail: error toast, stays in selection mode", async () => {
    const onDone = vi.fn();
    mockBatchAddRepos.mockResolvedValue({ success: 0, failed: 2, total: 2 });
    renderBar({ onDone });

    await userEvent.setup().click(screen.getByRole("button", { name: "Add 2 to Watchlist" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(onDone).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("API throws: error toast, stays in selection mode, button re-enabled", async () => {
    const onDone = vi.fn();
    mockBatchAddRepos.mockRejectedValue(new Error("Network error"));
    renderBar({ onDone });

    await userEvent.setup().click(screen.getByRole("button", { name: "Add 2 to Watchlist" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
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
