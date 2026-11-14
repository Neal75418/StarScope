/**
 * 熱門主題建議的行為測試。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TrendingTopics } from "../TrendingTopics";
import * as client from "../../../api/client";
import { queryKeys } from "../../../lib/react-query";

vi.mock("../../../api/client");

function renderWith(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>), qc };
}

const TOPIC = {
  topic: "local-first",
  sample_count: 20,
  global_count: 15196,
  heat: 131.6,
  already_added: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getTrendingTopics).mockResolvedValue({
    topics: [TOPIC],
    computed_at: "2026-08-15T10:00:00Z",
  });
});

describe("TrendingTopics", () => {
  it("shows cached results without calling GitHub", async () => {
    renderWith(<TrendingTopics onAdd={vi.fn()} />);
    expect(await screen.findByText("local-first")).toBeInTheDocument();
    // 讀取快取絕不能自己觸發重算——那會偷偷吃掉與 feed 共用的搜尋配額
    expect(client.refreshTrendingTopics).not.toHaveBeenCalled();
  });

  it("prompts to refresh when nothing has been computed yet", async () => {
    vi.mocked(client.getTrendingTopics).mockResolvedValue({ topics: [], computed_at: null });
    renderWith(<TrendingTopics onAdd={vi.fn()} />);
    expect(await screen.findByText(/Not checked yet/)).toBeInTheDocument();
  });

  it("recomputes only when the button is pressed", async () => {
    vi.mocked(client.refreshTrendingTopics).mockResolvedValue({
      topics: [{ ...TOPIC, topic: "tauri" }],
      computed_at: "2026-08-15T11:00:00Z",
    });
    renderWith(<TrendingTopics onAdd={vi.fn()} />);
    await screen.findByText("local-first");

    fireEvent.click(screen.getByTestId("trending-refresh-btn"));
    await waitFor(() => expect(client.refreshTrendingTopics).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("tauri")).toBeInTheDocument();
  });

  it("adds a topic to interests when + is clicked", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    renderWith(<TrendingTopics onAdd={onAdd} />);
    await screen.findByText("local-first");
    fireEvent.click(screen.getByTestId("trending-add-local-first"));
    expect(onAdd).toHaveBeenCalledWith("local-first");
  });

  it("locks the button for topics already in the interest list", async () => {
    vi.mocked(client.getTrendingTopics).mockResolvedValue({
      topics: [{ ...TOPIC, already_added: true }],
      computed_at: "2026-08-15T10:00:00Z",
    });
    const onAdd = vi.fn();
    renderWith(<TrendingTopics onAdd={onAdd} />);
    await screen.findByText("local-first");

    const btn = screen.getByTestId("trending-add-local-first");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("explains the shared search quota when refresh fails", async () => {
    vi.mocked(client.refreshTrendingTopics).mockRejectedValue(new Error("boom"));
    renderWith(<TrendingTopics onAdd={vi.fn()} />);
    await screen.findByText("local-first");
    fireEvent.click(screen.getByTestId("trending-refresh-btn"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("TrendingTopics 進行中的回饋", () => {
  it("shows progress instead of the empty prompt while refreshing", async () => {
    // 這條守的是一個真實回報：按下更新後，畫面正中央仍寫著「尚未查詢過」，
    // 只有按鈕在轉，使用者以為沒按到。兩分鐘的操作不能讓內容區看起來沒反應。
    vi.mocked(client.getTrendingTopics).mockResolvedValue({ topics: [], computed_at: null });
    vi.mocked(client.refreshTrendingTopics).mockReturnValue(new Promise(() => {}));

    renderWith(<TrendingTopics onAdd={vi.fn()} />);
    await screen.findByText(/Not checked yet/);

    fireEvent.click(screen.getByTestId("trending-refresh-btn"));

    expect(await screen.findByTestId("trending-progress")).toBeInTheDocument();
    expect(screen.queryByText(/Hit Refresh to see/)).not.toBeInTheDocument();
  });
});

describe("TrendingTopics 進度回報", () => {
  it("shows the stage and count while a refresh is running", async () => {
    vi.mocked(client.getTrendingTopics).mockResolvedValue({ topics: [], computed_at: null });
    vi.mocked(client.refreshTrendingTopics).mockReturnValue(new Promise(() => {}));
    vi.mocked(client.getTrendingProgress).mockResolvedValue({
      running: true,
      phase: "counting",
      done: 12,
      total: 25,
    });

    renderWith(<TrendingTopics onAdd={vi.fn()} />);
    await screen.findByText(/Not checked yet/);
    fireEvent.click(screen.getByTestId("trending-refresh-btn"));

    // 階段與數字都要出現——只顯示「處理中」無法分辨還在跑或卡住
    expect(
      await screen.findByText(/Measuring how common each topic is 12\/25/)
    ).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    // counting 階段佔後 75%：25 + (12/25)*75 = 61
    expect(bar).toHaveAttribute("aria-valuenow", "61");
  });

  it("falls back to an indeterminate bar before the first progress arrives", async () => {
    vi.mocked(client.getTrendingTopics).mockResolvedValue({ topics: [], computed_at: null });
    vi.mocked(client.refreshTrendingTopics).mockReturnValue(new Promise(() => {}));
    vi.mocked(client.getTrendingProgress).mockResolvedValue({
      running: false,
      phase: "",
      done: 0,
      total: 0,
    });

    renderWith(<TrendingTopics onAdd={vi.fn()} />);
    await screen.findByText(/Not checked yet/);
    fireEvent.click(screen.getByTestId("trending-refresh-btn"));

    const bar = await screen.findByRole("progressbar");
    // 還不知道進度時不能假裝 0%，那看起來像卡住
    expect(bar).not.toHaveAttribute("aria-valuenow");
  });

  it("says the saved results failed to load instead of claiming nothing was checked yet", async () => {
    // 「尚未查詢過」與「讀不到上次的結果」是兩件事
    vi.mocked(client.getTrendingTopics).mockRejectedValue(new Error("boom"));
    renderWith(<TrendingTopics onAdd={vi.fn()} />);

    expect(await screen.findByTestId("trending-load-error")).toHaveTextContent(
      "Couldn't load the previous results."
    );
    expect(screen.queryByText(/Not checked yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hit Refresh/)).not.toBeInTheDocument();
  });

  it("does not claim nothing was checked yet while the saved results are still loading", async () => {
    vi.mocked(client.getTrendingTopics).mockReturnValue(new Promise(() => {}));
    renderWith(<TrendingTopics onAdd={vi.fn()} />);
    // 等一拍：React Query 以 setTimeout(0) 才通知元件，馬上斷言「沒出現」會空過
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(screen.queryByText(/Not checked yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hit Refresh/)).not.toBeInTheDocument();
  });

  it("shows the saved results once loading them is retried", async () => {
    vi.mocked(client.getTrendingTopics).mockRejectedValueOnce(new Error("boom"));
    renderWith(<TrendingTopics onAdd={vi.fn()} />);
    const error = await screen.findByTestId("trending-load-error");

    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("local-first")).toBeInTheDocument();
    expect(screen.queryByTestId("trending-load-error")).not.toBeInTheDocument();
  });

  it("does not prompt to refresh when reloading an empty result fails", async () => {
    // 上一次讀到的是「沒有結果」，不代表現在還是沒有
    vi.mocked(client.getTrendingTopics).mockResolvedValue({ topics: [], computed_at: null });
    const { qc } = renderWith(<TrendingTopics onAdd={vi.fn()} />);
    expect(await screen.findByText(/Hit Refresh/)).toBeInTheDocument();

    vi.mocked(client.getTrendingTopics).mockRejectedValue(new Error("boom"));
    void qc.invalidateQueries({ queryKey: queryKeys.interests.trending() });

    expect(await screen.findByTestId("trending-load-error")).toBeInTheDocument();
    expect(screen.queryByText(/Hit Refresh/)).not.toBeInTheDocument();
  });
});
