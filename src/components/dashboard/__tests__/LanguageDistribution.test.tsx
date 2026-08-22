/**
 * 語言分佈：原本是甜甜圈，讀出一個數字要做四件事。
 *
 * 這三條各釘住一個曾經真實存在的問題：
 *   1. 圖例被 Recharts 照字母重排，而扇形照數量排——兩份清單順序不一致
 *   2. 面板上一個數字都沒有，數值只存在於 tooltip
 *   3. 最大的兩塊是幾乎同色而且相鄰（加權色距 56.8，中位數 294.9）
 */

import { cloneElement, type ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LanguageDistribution } from "../LanguageDistribution";

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// jsdom 沒有版面配置，ResponsiveContainer 量到的寬高是 0，圖表整個不畫。
// 只換掉這一層、把尺寸直接塞給裡面的 BarChart——底下 Bar / Cell / LabelList /
// YAxis 全都是真的 recharts。整包 stub 掉的話這些測試就只是在測 stub。
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

const data = [
  { language: "TypeScript", count: 19 },
  { language: "Python", count: 18 },
  { language: "Java", count: 18 },
  { language: "其他", count: 6 },
];

describe("LanguageDistribution", () => {
  it("每個語言的數量都直接印在畫面上，不用 hover", () => {
    // 甜甜圈版本整個面板沒有任何數字，實測 /\d/ 比對為 false
    render(<LanguageDistribution data={data} />);

    const panel = screen.getByTestId("language-distribution");
    for (const { count } of data) {
      expect(within(panel).getAllByText(String(count)).length).toBeGreaterThan(0);
    }
  });

  it("語言名稱與數量在畫面上的順序一致——不需要靠顏色配對", () => {
    // 甜甜圈版本圖例是字母序、扇形是數量序，兩者唯一的橋是顏色
    render(<LanguageDistribution data={data} />);

    const text = screen.getByTestId("language-distribution").textContent ?? "";
    const positions = data.map((d) => text.indexOf(d.language));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("空清單時說明而不是畫一張空圖", () => {
    render(<LanguageDistribution data={[]} />);

    expect(screen.queryByTestId("language-distribution")).not.toBeInTheDocument();
  });

  it("語言變多時面板跟著變高，不把列擠在一起", () => {
    // 寫死高度的話，兩種語言和十種語言會擠在同一個框裡
    const h = (data: { language: string; count: number }[]) => {
      const { getByTestId, unmount } = render(<LanguageDistribution data={data} />);
      const height = Number.parseInt(getByTestId("chart-area").style.minHeight, 10);
      unmount();
      return height;
    };
    const ten = Array.from({ length: 10 }, (_, i) => ({ language: `L${i}`, count: 10 - i }));

    expect(h(ten)).toBeGreaterThan(h(data.slice(0, 2)));
  });
});
