/**
 * 近 7 天摘要（週報摘要）的讀取：已經有資料時重讀失敗，保留內容、另外說沒有更新成功（跟儀表板主體一樣）；
 * 第一次就讀不到時說讀不到並給重試，按重試不會整塊換成骨架。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import type { ReactNode } from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { WeeklySummary } from "../WeeklySummary";
import * as apiClient from "../../../api/client";
import type { WeeklySummaryResponse } from "../../../api/client";
import { createTestQueryClient, queryKeys } from "../../../lib/react-query";
import { translations } from "../../../i18n/translations";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getWeeklySummary: vi.fn(),
}));

const t = translations.en;

const summary: WeeklySummaryResponse = {
  period_start: "2026-08-09",
  period_end: "2026-08-16",
  total_repos: 94,
  total_new_stars: 1234,
  repos_compared: 94,
  top_gainers: [],
  top_losers: [],
  alerts_triggered: 0,
  early_signals_detected: 0,
  early_signals_by_type: {},
  hn_mentions: [],
  releases: [],
  accelerating: 0,
  decelerating: 0,
};

function renderSummary() {
  const client = createTestQueryClient();
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, gcTime: Infinity },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, ...render(createElement(WeeklySummary), { wrapper }) };
}

describe("WeeklySummary loading", () => {
  // 一條失敗沒用完的 mock*Once 不能漏到下一條
  beforeEach(() => vi.mocked(apiClient.getWeeklySummary).mockReset());

  it("keeps what it showed when a refresh fails, and says it wasn't updated", async () => {
    vi.mocked(apiClient.getWeeklySummary).mockResolvedValueOnce(summary);
    const { client } = renderSummary();
    // 等真的內容：骨架也用 .weekly-grid，等它的話第一次讀取還沒結束、重讀會併進去
    await screen.findByTestId("weekly-total-stars");

    vi.mocked(apiClient.getWeeklySummary).mockRejectedValueOnce(new Error("boom"));
    await act(async () => {
      await client.refetchQueries({ queryKey: queryKeys.dashboard.weeklySummary(7) });
    });

    expect(await screen.findByText(t.dashboard.weekly.refreshFailed)).toBeInTheDocument();
    expect(screen.getByTestId("weekly-total-stars")).toBeInTheDocument();
    expect(screen.queryByText(t.dashboard.weekly.loadError)).not.toBeInTheDocument();

    // 那則說明附的重試：按了顯示重試中，內容照樣留著
    vi.mocked(apiClient.getWeeklySummary).mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: t.common.retry }));
    expect(await screen.findByRole("button", { name: t.common.retrying })).toBeInTheDocument();
    expect(screen.getByTestId("weekly-total-stars")).toBeInTheDocument();
  });

  it("offers a retry when it couldn't load at all, and keeps the button while retrying", async () => {
    vi.mocked(apiClient.getWeeklySummary)
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderSummary();
    await screen.findByText(t.dashboard.weekly.loadError);

    fireEvent.click(screen.getByRole("button", { name: t.common.retry }));

    expect(await screen.findByRole("button", { name: t.common.retrying })).toBeInTheDocument();
  });
});
