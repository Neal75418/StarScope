/**
 * useFeed hook 測試：空 feed 自動觸發 generate、有資料不觸發、防無限迴圈。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useFeed } from "../useFeed";
import * as apiClient from "../../api/client";
import { createTestQueryClient, queryKeys } from "../../lib/react-query";
import type { FeedItem } from "../../api/types";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getFeed: vi.fn(),
    generateFeed: vi.fn(),
    sendFeedFeedback: vi.fn(),
  };
});

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const FEED_ITEM: FeedItem = {
  id: 1,
  github_id: 10,
  full_name: "a/one",
  owner: "a",
  name: "one",
  description: null,
  language: "Rust",
  topics: ["tauri"],
  stars: 100,
  forks: 1,
  url: "https://github.com/a/one",
  owner_avatar_url: null,
  score: 2.5,
  reason: { matched: ["topic:tauri"], stars: 100, age_days: 45, pushed_at: null },
  feedback: null,
};

beforeEach(() => vi.clearAllMocks());

describe("useFeed", () => {
  it("returns items when feed is non-empty and does not generate", async () => {
    vi.mocked(apiClient.getFeed).mockResolvedValue({
      feed_date: "2026-08-01",
      items: [FEED_ITEM],
    });

    const { result } = renderHook(() => useFeed(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(apiClient.generateFeed).not.toHaveBeenCalled();
  });

  it("auto-generates when today's feed is empty", async () => {
    vi.mocked(apiClient.getFeed)
      .mockResolvedValueOnce({ feed_date: "2026-08-01", items: [] })
      .mockResolvedValue({ feed_date: "2026-08-01", items: [FEED_ITEM] });
    vi.mocked(apiClient.generateFeed).mockResolvedValue({
      feed_date: "2026-08-01",
      generated: 1,
    });

    const { result } = renderHook(() => useFeed(), { wrapper: createWrapper() });

    await waitFor(() => expect(apiClient.generateFeed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
  });

  it("generate is not retriggered when result is still empty (no interests)", async () => {
    vi.mocked(apiClient.getFeed).mockResolvedValue({ feed_date: "2026-08-01", items: [] });
    vi.mocked(apiClient.generateFeed).mockResolvedValue({
      feed_date: "2026-08-01",
      generated: 0,
    });

    renderHook(() => useFeed(), { wrapper: createWrapper() });

    await waitFor(() => expect(apiClient.generateFeed).toHaveBeenCalledTimes(1));
    // 再等一輪確認沒有第二次呼叫（防 infinite generate loop）
    await new Promise((r) => setTimeout(r, 50));
    expect(apiClient.generateFeed).toHaveBeenCalledTimes(1);
  });

  it("isGenerating is true while generate is pending", async () => {
    vi.mocked(apiClient.getFeed).mockResolvedValue({ feed_date: "2026-08-01", items: [] });
    let resolveGenerate!: (value: { feed_date: string; generated: number }) => void;
    vi.mocked(apiClient.generateFeed).mockReturnValue(
      new Promise((resolve) => {
        resolveGenerate = resolve;
      })
    );

    const { result } = renderHook(() => useFeed(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isGenerating).toBe(true));

    resolveGenerate({ feed_date: "2026-08-01", generated: 0 });

    await waitFor(() => expect(result.current.isGenerating).toBe(false));
  });

  it("feedback calls API", async () => {
    vi.mocked(apiClient.getFeed).mockResolvedValue({
      feed_date: "2026-08-01",
      items: [FEED_ITEM],
    });
    vi.mocked(apiClient.sendFeedFeedback).mockResolvedValue({
      ...FEED_ITEM,
      feedback: "dismissed",
    });

    const { result } = renderHook(() => useFeed(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    result.current.feedback(1, "dismissed");

    await waitFor(() => expect(apiClient.sendFeedFeedback).toHaveBeenCalledWith(1, "dismissed"));
  });

  it("feedback 成功後 invalidate feed.all（starred 統計靠它刷新）", async () => {
    vi.mocked(apiClient.getFeed).mockResolvedValue({
      feed_date: "2026-08-01",
      items: [FEED_ITEM],
    });
    vi.mocked(apiClient.sendFeedFeedback).mockResolvedValue({
      ...FEED_ITEM,
      feedback: "starred",
    });

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useFeed(), { wrapper });

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    result.current.feedback(1, "starred");

    // 必須是 feed.all 而非 feed.today：feedback 同時改動 stats
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.feed.all })
    );
  });

  it("generate 成功後 invalidate feed.all（shown 統計靠它刷新）", async () => {
    vi.mocked(apiClient.getFeed).mockResolvedValue({ feed_date: "2026-08-01", items: [] });
    vi.mocked(apiClient.generateFeed).mockResolvedValue({
      feed_date: "2026-08-01",
      generated: 1,
    });

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    renderHook(() => useFeed(), { wrapper });

    // 空 feed 觸發自動 generate，成功後必須 invalidate feed.all
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.feed.all })
    );
  });
});
