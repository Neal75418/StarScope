/**
 * 本週新版本面板。
 *
 * 為什麼加這一欄：HN 一週只講得到 94 個追蹤中 repo 的 5 個，同一份清單近 7 天卻有
 * 14 個發了新版本。標記（破壞性變更 / 安全性）是把「14 個新版本」變成
 * 「這兩個今天該點進去」的關鍵，所以標記顯示不出來這一欄就沒有意義。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../../lib/react-query";
import { WeeklySummary } from "../WeeklySummary";
import type { WeeklyRelease, WeeklySummaryResponse } from "../../../api/types";

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../utils/url", () => ({ safeOpenUrl: vi.fn() }));
vi.mock("../../Skeleton", () => ({ Skeleton: () => null }));

const state = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("../../../hooks/useWeeklySummary", () => ({
  useWeeklySummary: () => ({ data: state.data, isLoading: false, error: null }),
}));

function release(overrides: Partial<WeeklyRelease> = {}): WeeklyRelease {
  return {
    repo_id: 1,
    repo_name: "ollama/ollama",
    title: "v0.12.0",
    url: "https://github.com/ollama/ollama/releases/tag/v0.12.0",
    tags: [],
    published_at: "2026-08-14T00:00:00Z",
    ...overrides,
  };
}

function renderWith(releases: WeeklyRelease[]) {
  state.data = {
    period_start: "2026-08-09",
    period_end: "2026-08-16",
    total_repos: 94,
    total_new_stars: 0,
    repos_compared: 94,
    top_gainers: [],
    top_losers: [],
    alerts_triggered: 0,
    early_signals_detected: 0,
    early_signals_by_type: {},
    hn_mentions: [],
    releases,
    accelerating: 0,
    decelerating: 0,
  } satisfies WeeklySummaryResponse;

  const client = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return render(createElement(WeeklySummary), { wrapper });
}

describe("WeeklySummary releases", () => {
  it("lists the week's releases with a link to each", () => {
    renderWith([release(), release({ repo_id: 2, repo_name: "n8n-io/n8n", title: "v1.5.0" })]);

    const panel = screen.getByTestId("weekly-releases");
    expect(within(panel).getByText("ollama/ollama")).toBeInTheDocument();
    expect(within(panel).getByText("v1.5.0")).toBeInTheDocument();
    expect(within(panel).getAllByRole("link")).toHaveLength(2);
  });

  it("shows the tags that decide whether to read it today", () => {
    renderWith([
      release({ repo_name: "redis/jedis", title: "v6.2.0", tags: ["breaking", "deprecation"] }),
    ]);

    const panel = screen.getByTestId("weekly-releases");
    // 測試環境走英文文案（src/test/setup.ts 的全域 mock）
    expect(within(panel).getByText("breaking")).toBeInTheDocument();
    expect(within(panel).getByText("deprecation")).toBeInTheDocument();
  });

  it("renders nothing extra for an untagged release", () => {
    renderWith([release({ tags: [] })]);

    const panel = screen.getByTestId("weekly-releases");
    expect(within(panel).queryByText("breaking")).not.toBeInTheDocument();
    expect(within(panel).queryByText("security")).not.toBeInTheDocument();
  });

  it("says so when the week had no releases", () => {
    renderWith([]);

    expect(screen.getByTestId("weekly-releases")).toHaveTextContent(/no new releases/i);
  });

  it("survives a response from a sidecar that does not send releases yet", () => {
    // 前端比後端新時欄位不存在。少了保險會在 .map 上直接炸掉整個儀表板。
    const { releases: _omitted, ...withoutField } = {
      period_start: "2026-08-09",
      period_end: "2026-08-16",
      total_repos: 94,
      total_new_stars: 0,
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
    } satisfies WeeklySummaryResponse;
    state.data = withoutField;

    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    render(createElement(WeeklySummary), { wrapper });

    expect(screen.getByTestId("weekly-releases")).toHaveTextContent(/no new releases/i);
  });
});
