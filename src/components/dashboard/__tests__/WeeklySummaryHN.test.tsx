/**
 * WeeklySummary HN 提及互動測試。
 * 驗證 HN mentions 使用真正的 <a> 元素。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../../lib/react-query";
import { WeeklySummary } from "../WeeklySummary";

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../utils/url", () => ({
  safeOpenUrl: vi.fn(),
}));

vi.mock("../../../hooks/useWeeklySummary", () => ({
  useWeeklySummary: () => ({
    data: {
      period_start: "2026-03-15",
      period_end: "2026-03-22",
      total_repos: 5,
      total_new_stars: 1000,
      top_gainers: [],
      top_losers: [],
      alerts_triggered: 0,
      early_signals_detected: 0,
      early_signals_by_type: {},
      hn_mentions: [
        {
          repo_id: 1,
          repo_name: "facebook/react",
          hn_title: "React 20 Released",
          hn_score: 500,
          hn_url: "https://news.ycombinator.com/item?id=12345",
        },
      ],
      accelerating: 1,
      decelerating: 0,
    },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../Skeleton", () => ({
  Skeleton: () => null,
}));

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

import { safeOpenUrl } from "../../../utils/url";

describe("WeeklySummary HN Mentions", () => {
  it("renders HN mention as real <a> with correct href", () => {
    render(<WeeklySummary />, { wrapper: createWrapper() });

    const link = screen.getByText("React 20 Released").closest("a");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("href", "https://news.ycombinator.com/item?id=12345");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("clicking HN mention calls safeOpenUrl", () => {
    render(<WeeklySummary />, { wrapper: createWrapper() });

    const link = screen.getByText("React 20 Released").closest("a");
    expect(link).not.toBeNull();
    fireEvent.click(link as HTMLElement);

    expect(safeOpenUrl).toHaveBeenCalledWith("https://news.ycombinator.com/item?id=12345");
  });

  it("shows HN score", () => {
    render(<WeeklySummary />, { wrapper: createWrapper() });

    expect(screen.getByText("500 pts")).toBeInTheDocument();
  });
});
