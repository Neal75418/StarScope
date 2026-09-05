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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DailyStarsChart } from "../DailyStarsChart";
import { createTestQueryClient, queryKeys } from "../../../lib/react-query";
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
    // 正向的日子一律主色：沒有這條，fill 寫死成警示色只有「掉星」那條測試會抓到一半
    expect(rendered.every((b) => b.fill === "var(--accent-fg)")).toBe(true);
  });

  it("還沒過完的今天用半透明", async () => {
    // 其他測試的日期都在 2026-01，永遠不等於今天——partial 分支從沒被走到過
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    vi.mocked(getPortfolioHistory).mockResolvedValue({
      history: [
        { date: yesterday, total_stars: 1000 },
        { date: today, total_stars: 1050 },
      ],
    } as never);

    render(<DailyStarsChart days={30} onChangeDays={vi.fn()} />, { wrapper });

    await waitFor(() => expect(bars().length).toBe(1));
    expect(bars()[0].opacity).toBe("0.4");
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

describe("資料縮短時的 re-render", () => {
  it("days 從 30 切到 7 且快取命中（同步縮短）時不得崩潰", async () => {
    // 第三方審查抓到的 Critical：shape callback 用 props.index 回查自己的陣列，
    // 但 Recharts 的 store 要到 effect 才更新——資料縮短的那一次 render，
    // Bar 仍拿舊資料的 rectangle 呼叫 shape，index 超過新陣列長度就是 undefined。
    // 舊的 Cell 路徑有 `cells[index] &&` 守著，遷移時被拿掉。
    // 快取命中讓兩筆資料在同一次 render 內切換，正是最容易踩到的路徑
    // （React Query gcTime 30 分鐘，切回去過的區間都是同步命中）。
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const history = (n: number) => ({
      history: Array.from({ length: n + 1 }, (_, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, "0")}`,
        total_stars: 1000 + i * 10,
      })),
    });
    client.setQueryData(queryKeys.dashboard.portfolioHistory(30), history(30));
    client.setQueryData(queryKeys.dashboard.portfolioHistory(7), history(7));
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { rerender } = render(<DailyStarsChart days={30} onChangeDays={() => {}} />, {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(bars().length).toBe(30));

    expect(() => rerender(<DailyStarsChart days={7} onChangeDays={() => {}} />)).not.toThrow();
    await waitFor(() => expect(bars().length).toBe(7));
  });
});
