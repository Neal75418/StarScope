/**
 * ForYouFeed 測試：渲染、推薦理由、回饋動作。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ForYouFeed } from "../ForYouFeed";
import * as client from "../../../api/client";

vi.mock("../../../api/client");

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const ITEM = {
  id: 1,
  github_id: 10,
  full_name: "a/one",
  owner: "a",
  name: "one",
  description: "a tauri app",
  language: "Rust",
  topics: ["tauri"],
  stars: 380,
  forks: 4,
  url: "https://github.com/a/one",
  owner_avatar_url: null,
  score: 2.5,
  reason: {
    matched: ["topic:tauri"],
    stars: 380,
    age_days: 45,
    pushed_at: "2026-07-30T00:00:00Z",
  },
  feedback: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getFeed).mockResolvedValue({
    feed_date: "2026-08-01",
    items: [ITEM],
  });
});

describe("ForYouFeed", () => {
  it("reason line shows matched interests without the noisy topic: prefix", async () => {
    renderWithClient(<ForYouFeed onAddToWatchlist={vi.fn()} />);
    expect(await screen.findByText("a/one")).toBeInTheDocument();
    const reasonLine = screen.getByTestId("feed-reason-1");
    expect(reasonLine).toHaveTextContent("tauri");
    expect(reasonLine.textContent).not.toContain("topic:");
    // 星數只在 meta 列出現一次，理由行不再重複同一個數字
    expect(reasonLine.textContent).not.toContain("380");
  });

  it("keeps the kind prefix for non-topic matches (that is how it got pulled in)", async () => {
    vi.mocked(client.getFeed).mockResolvedValue({
      feed_date: "2026-08-01",
      items: [{ ...ITEM, reason: { ...ITEM.reason, matched: ["topic:tauri", "language:rust"] } }],
    });
    renderWithClient(<ForYouFeed onAddToWatchlist={vi.fn()} />);
    await screen.findByText("a/one");
    expect(screen.getByTestId("feed-reason-1")).toHaveTextContent("tauri · language:rust");
  });

  it("shows 'created today' instead of the awkward '0 days old'", async () => {
    vi.mocked(client.getFeed).mockResolvedValue({
      feed_date: "2026-08-01",
      items: [{ ...ITEM, reason: { ...ITEM.reason, age_days: 0 } }],
    });
    renderWithClient(<ForYouFeed onAddToWatchlist={vi.fn()} />);
    await screen.findByText("a/one");
    expect(screen.getByTestId("feed-age-1")).toHaveTextContent("created today");
  });

  it("dismiss button sends feedback", async () => {
    vi.mocked(client.sendFeedFeedback).mockResolvedValue({ ...ITEM, feedback: "dismissed" });
    renderWithClient(<ForYouFeed onAddToWatchlist={vi.fn()} />);
    await screen.findByText("a/one");
    fireEvent.click(screen.getByTestId("feed-dismiss-1"));
    await waitFor(() => expect(client.sendFeedFeedback).toHaveBeenCalledWith(1, "dismissed"));
  });

  it("track button calls onAddToWatchlist and sends starred feedback", async () => {
    vi.mocked(client.sendFeedFeedback).mockResolvedValue({ ...ITEM, feedback: "starred" });
    const onAdd = vi.fn().mockResolvedValue(true);
    renderWithClient(<ForYouFeed onAddToWatchlist={onAdd} />);
    await screen.findByText("a/one");
    fireEvent.click(screen.getByTestId("feed-star-1"));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(client.sendFeedFeedback).toHaveBeenCalledWith(1, "starred");
  });

  it("does not send starred feedback when adding to watchlist fails", async () => {
    const onAdd = vi.fn().mockResolvedValue(false);
    renderWithClient(<ForYouFeed onAddToWatchlist={onAdd} />);
    await screen.findByText("a/one");
    fireEvent.click(screen.getByTestId("feed-star-1"));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(client.sendFeedFeedback).not.toHaveBeenCalledWith(1, "starred");
  });

  it("shows empty state when no items and generation done", async () => {
    vi.mocked(client.getFeed).mockResolvedValue({ feed_date: "2026-08-01", items: [] });
    vi.mocked(client.generateFeed).mockResolvedValue({
      feed_date: "2026-08-01",
      generated: 0,
    });
    renderWithClient(<ForYouFeed onAddToWatchlist={vi.fn()} />);
    expect(await screen.findByTestId("feed-empty-state")).toBeInTheDocument();
  });

  it("shows last push time so a dead project can be ruled out at a glance", async () => {
    renderWithClient(<ForYouFeed onAddToWatchlist={vi.fn()} />);
    await screen.findByText("a/one");
    expect(screen.getByTestId("feed-pushed-1")).toBeInTheDocument();
  });

  it("omits last push when the repo has no pushed_at", async () => {
    vi.mocked(client.getFeed).mockResolvedValue({
      feed_date: "2026-08-01",
      items: [{ ...ITEM, reason: { ...ITEM.reason, pushed_at: null } }],
    });
    renderWithClient(<ForYouFeed onAddToWatchlist={vi.fn()} />);
    await screen.findByText("a/one");
    expect(screen.queryByTestId("feed-pushed-1")).not.toBeInTheDocument();
  });

  it("shows the feed date so it is clear which day the picks belong to", async () => {
    renderWithClient(<ForYouFeed onAddToWatchlist={vi.fn()} />);
    expect(await screen.findByTestId("feed-date")).toHaveTextContent("2026-08-01");
  });

  it("reports a load failure as an error, not as 'no interests configured'", async () => {
    vi.mocked(client.getFeed).mockRejectedValue(new Error("network down"));
    renderWithClient(<ForYouFeed onAddToWatchlist={vi.fn()} />);
    const empty = await screen.findByTestId("feed-empty-state");
    expect(empty).toHaveTextContent("Couldn't load today's feed.");
    expect(empty).not.toHaveTextContent("Add interests in Settings");
  });

  it("reports a generate failure as an error too (query succeeds but returns empty)", async () => {
    // generate 掛掉時 getFeed 仍會成功回傳空清單，只看 query.isError 會誤報成「還沒設定興趣」
    vi.mocked(client.getFeed).mockResolvedValue({ feed_date: "2026-08-01", items: [] });
    vi.mocked(client.generateFeed).mockRejectedValue(new Error("rate limited"));
    renderWithClient(<ForYouFeed onAddToWatchlist={vi.fn()} />);
    const empty = await screen.findByTestId("feed-empty-state");
    await waitFor(() => expect(empty).toHaveTextContent("Couldn't load today's feed."));
  });

  it("locks the track button while adding so a double-click cannot add twice", async () => {
    let resolveAdd!: (v: boolean) => void;
    const onAdd = vi.fn().mockReturnValue(new Promise<boolean>((r) => (resolveAdd = r)));
    renderWithClient(<ForYouFeed onAddToWatchlist={onAdd} />);
    await screen.findByText("a/one");
    const btn = screen.getByTestId("feed-star-1");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onAdd).toHaveBeenCalledTimes(1);
    resolveAdd(true);
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it("shows all-caught-up message when every item has been dismissed", async () => {
    vi.mocked(client.getFeed).mockResolvedValue({
      feed_date: "2026-08-01",
      items: [{ ...ITEM, feedback: "dismissed" }],
    });
    renderWithClient(<ForYouFeed onAddToWatchlist={vi.fn()} />);
    expect(await screen.findByTestId("feed-all-dismissed")).toBeInTheDocument();
    expect(screen.queryByText("a/one")).not.toBeInTheDocument();
  });
});
