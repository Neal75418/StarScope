/**
 * 每日新增星數：釘住「哪幾根長條不能全信」這個視覺編碼。
 *
 * 淡色（fillOpacity 0.4）代表推估或未完成的資料——缺口攤平出來的日子、
 * 以及還沒過完的今天。那是這張圖唯一的誠實機制：沒有它，推估值看起來
 * 就跟實測值一樣可信。
 *
 * 這個檔案在 Cell → shape prop 遷移（Recharts 4 會移除 Cell）時補上：
 * 當時三張長條圖都沒有任何測試覆蓋顏色與透明度，改壞了不會有人知道。
 */
import { cloneElement, type ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DailyStarsChart } from "../DailyStarsChart";
import { createTestQueryClient } from "../../../lib/react-query";
import { getPortfolioHistory } from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/client")>();
  return { ...actual, getPortfolioHistory: vi.fn() };
});

// jsdom 沒有版面配置，ResponsiveContainer 量到 0×0 就整張不畫。
// 只換掉這一層，底下 Bar / shape / Rectangle 都是真的 recharts——
// 整包 stub 掉的話就只是在測 stub。
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => (
      <div data-testid="chart-container">
        {cloneElement(children, { width: 600, height: 300 } as Partial<unknown>)}
      </div>
    ),
  };
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function bars(): { fill: string | null; opacity: string }[] {
  return [...document.querySelectorAll(".recharts-bar-rectangle path")].map((p) => ({
    fill: p.getAttribute("fill"),
    opacity: p.getAttribute("fill-opacity") ?? "1",
  }));
}

describe("DailyStarsChart 的長條標記", () => {
  beforeEach(() => vi.clearAllMocks());

  it("缺口攤平出來的日子用半透明，實測的日子不透明", async () => {
    // 1/01 → 1/02 是實測（相隔一天）；1/02 → 1/05 中間缺兩天，
    // 攤平成三根 spanDays=3 的長條，全部該是淡的
    vi.mocked(getPortfolioHistory).mockResolvedValue({
      history: [
        { date: "2026-01-01", total_stars: 1000 },
        { date: "2026-01-02", total_stars: 1100 },
        { date: "2026-01-05", total_stars: 1400 },
      ],
    } as never);

    render(<DailyStarsChart days={30} onChangeDays={vi.fn()} />, { wrapper });

    await waitFor(() => expect(bars().length).toBeGreaterThan(0));

    const rendered = bars();
    const dim = rendered.filter((b) => b.opacity === "0.4");
    const solid = rendered.filter((b) => b.opacity === "1");
    expect(solid).toHaveLength(1); // 1/02 那根實測值
    expect(dim).toHaveLength(3); // 攤平出來的 1/03、1/04、1/05
  });

  it("掉星的日子用警示色，不是寫死的正向色", async () => {
    vi.mocked(getPortfolioHistory).mockResolvedValue({
      history: [
        { date: "2026-01-01", total_stars: 1000 },
        { date: "2026-01-02", total_stars: 900 },
      ],
    } as never);

    render(<DailyStarsChart days={30} onChangeDays={vi.fn()} />, { wrapper });

    await waitFor(() => expect(bars().length).toBeGreaterThan(0));

    expect(bars()[0].fill).toBe("var(--danger-fg)");
  });
});
