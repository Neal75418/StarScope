/**
 * 「近 7 天摘要」在沒有 7 天前快照可比時，不能講得像已經比過了。
 *
 * 實測畫面上出現過兩種說法並列：健康分數已經改口說「快照累積中」，
 * 這個面板卻還在說「0 近 7 天新增星數」「近 7 天無變動」。
 * 後端算的是 sum(空集合)，一樣是把「沒得比」講成「沒有變動」。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "../../../lib/react-query";
import { WeeklySummary } from "../WeeklySummary";
import type { WeeklySummaryResponse } from "../../../api/types";

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../utils/url", () => ({ safeOpenUrl: vi.fn() }));
vi.mock("../../Skeleton", () => ({ Skeleton: () => null }));

const state = vi.hoisted(() => ({ data: null as unknown }));

vi.mock("../../../hooks/useWeeklySummary", () => ({
  useWeeklySummary: () => ({ data: state.data, isLoading: false, error: null }),
}));

function summary(overrides: Partial<WeeklySummaryResponse> = {}): WeeklySummaryResponse {
  return {
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
    ...overrides,
  };
}

function renderWith(data: WeeklySummaryResponse) {
  state.data = data;
  const client = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return render(createElement(WeeklySummary), { wrapper });
}

describe("WeeklySummary without a 7-day baseline", () => {
  it("does not claim zero stars when nothing could be compared", () => {
    renderWith(summary({ repos_compared: 0, total_new_stars: 0 }));

    // 測試環境走英文文案（src/test/setup.ts 的全域 mock）
    expect(screen.getByTestId("weekly-total-stars")).toHaveTextContent(/not comparable/i);
    expect(screen.getByTestId("weekly-total-stars")).not.toHaveTextContent(
      /stars in the last 7 days/i
    );
  });

  it("reports a real zero as a total, not as 'not comparable'", () => {
    // 94 個都比對過了、就是沒動——這個 0 是有意義的，徽章要照常顯示總和。
    // 漲跌排行已移除，「兩種空清單講不同的話」現在由「在動」那一段負責。
    renderWith(summary({ repos_compared: 94, total_new_stars: 0 }));

    expect(screen.getByTestId("weekly-total-stars")).toHaveTextContent(/stars in the last 7 days/i);
  });

  it("shows the real total once repos can be compared", () => {
    renderWith(summary({ repos_compared: 94, total_new_stars: 1234 }));

    // formatDelta 會縮寫成 +1.2K，不是原始數字
    expect(screen.getByTestId("weekly-total-stars")).toHaveTextContent("+1.2K");
  });
});

describe("WeeklySummary against an older sidecar", () => {
  it("treats a missing repos_compared as nothing compared", () => {
    // 前端比後端新時（開發常態）欄位不存在。舊寫法 `undefined === 0` 是 false，
    // 於是走進有把握的那一支，把「沒得比」講成「0 顆星」——正是要消掉的行為。
    const { repos_compared: _omitted, ...withoutField } = summary({ total_new_stars: 0 });
    renderWith(withoutField as WeeklySummaryResponse);

    expect(screen.getByTestId("weekly-total-stars")).toHaveTextContent(/not comparable/i);
  });
});

describe("WeeklySummary after signals refactor", () => {
  it("不再渲染訊號總覽——那四個數字都有更好的去處", () => {
    // 觸發警報 → 段一；早期訊號 → 段二上層的項目本身；加速/減速 → 段二的排行。
    // 「早期訊號 2」不能點、不能確認、不告訴你是哪兩個。
    renderWith(summary({ alerts_triggered: 3, early_signals_detected: 2 }));

    expect(screen.queryByText(/alerts triggered/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/early signals/i)).not.toBeInTheDocument();
  });
});
