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
  reason: { matched: ["topic:tauri"], stars: 380, age_days: 45 },
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
  it("renders feed items with reason line", async () => {
    renderWithClient(<ForYouFeed onAddToWatchlist={vi.fn()} />);
    expect(await screen.findByText("a/one")).toBeInTheDocument();
    expect(screen.getByText(/topic:tauri/)).toBeInTheDocument();
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
