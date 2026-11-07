/**
 * 批次加入的三個失敗分支（部分成功、全部失敗、API 例外）先前只在 Trends 的
 * TrendsBatchAddBar 測過；那個殼拆掉後邏輯還活在這裡，測試跟著搬過來。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { userEvent } from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient, queryKeys } from "../../../lib/react-query";
import { ApiError } from "../../../api/types";
import { BATCH_ADD_FOLLOWUP_INTERVAL_MS, BATCH_ADD_TIMEOUT_MS } from "../../../constants/api";
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

function renderBar(
  props: Partial<React.ComponentProps<typeof BatchAddBar>> = {},
  client = createTestQueryClient()
) {
  const ui: ReactElement = (
    <BatchAddBar selectedRepos={repos} selectedCount={repos.length} onDone={vi.fn()} {...props} />
  );
  // 用真的 ToastProvider：mock 掉 useToast 只能驗「有呼叫」，看不出訊息有沒有出現在畫面上
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>
  );
}

/** 畫面上某一類 toast 的文字；沒有這類 toast 時是空陣列。 */
function shownToasts(type: "success" | "warning" | "error" | "info"): string[] {
  return [...document.querySelectorAll(`.toast-${type} .toast-message`)].map(
    (el) => el.textContent ?? ""
  );
}

describe("BatchAddBar", () => {
  beforeEach(() => {
    mockBatchAddRepos.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("times out: says it is still processing and refetches the tracked repos", async () => {
    // 逾時時伺服器還在逐筆加入：說「發生錯誤」會讓人以為沒加入，名單也要重抓才看得到結果。
    // 逾時後會排 5 分鐘的定期重抓：用 fake timers，測試結束時（afterEach）一起丟掉，不會留在 worker 裡跑
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockBatchAddRepos.mockRejectedValue(new ApiError(0, "Request timed out"));
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderBar({}, client);

    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole("button", { name: "Add 2 to Watchlist" }));

    await waitFor(() =>
      expect(shownToasts("info")).toEqual([
        "Still adding — your watchlist will update over the next few minutes",
      ])
    );
    expect(shownToasts("error")).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.repos.all })
    );
  });

  it("times out: keeps refetching the tracked repos for a while, even after leaving the page", async () => {
    // 逾時當下的那次重抓只拿到做到一半的名單，repos 查詢之後 5 分鐘內又不會自己重抓；
    // 提示叫使用者去追蹤清單看，一離開探索頁這個元件就卸載了，重抓不能跟著停
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockBatchAddRepos.mockRejectedValue(new ApiError(0, "Request timed out"));
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const repoRefetches = () =>
      invalidate.mock.calls.filter(
        ([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(queryKeys.repos.all)
      ).length;
    const { unmount } = renderBar({}, client);

    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole("button", { name: "Add 2 to Watchlist" }));
    await waitFor(() => expect(shownToasts("info")).toHaveLength(1));
    expect(repoRefetches()).toBe(1);
    unmount();

    await vi.advanceTimersByTimeAsync(BATCH_ADD_FOLLOWUP_INTERVAL_MS);
    expect(repoRefetches()).toBe(2);

    await vi.advanceTimersByTimeAsync(BATCH_ADD_TIMEOUT_MS);
    const afterWindow = repoRefetches();
    expect(afterWindow).toBe(1 + BATCH_ADD_TIMEOUT_MS / BATCH_ADD_FOLLOWUP_INTERVAL_MS);

    // 有期限：不會一直重抓下去
    await vi.advanceTimersByTimeAsync(BATCH_ADD_TIMEOUT_MS);
    expect(repoRefetches()).toBe(afterWindow);
  });

  it("network failure: an error toast, not the still-processing hint, and refetches the tracked repos", async () => {
    // 網路錯誤也是 status 0，但多半是連不上 sidecar、伺服器沒有在處理：說「仍在處理」會讓人一直等。
    // 連線也可能在伺服器做到一半時斷掉，所以名單照樣重抓
    mockBatchAddRepos.mockRejectedValue(new ApiError(0, "Network error: Failed to fetch"));
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderBar({}, client);

    await userEvent.setup().click(screen.getByRole("button", { name: "Add 2 to Watchlist" }));

    await waitFor(() => expect(shownToasts("error")).toHaveLength(1));
    expect(shownToasts("info")).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.repos.all })
    );
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
