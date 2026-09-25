/**
 * 每日新增星數的換算規則。
 *
 * 日期與總星數取自 2026-08-22 的真實快照：8/15、8/16、8/18、8/21、8/22 五筆，
 * 中間缺 8/17、8/19、8/20。stars_gained 由 chain() 用總星數相減補上——8/15→8/16
 * 其實有兩個 repo 被封存，所以這組增量只用來測缺口攤平，不是當天的真實成長。
 */

import { describe, it, expect } from "vitest";
import { computeDailyStars, starAxisTicks } from "../dailyStars";
import type { PortfolioHistoryPoint } from "../../api/types";

const p = (
  date: string,
  total_stars: number,
  repo_count = 94,
  stars_gained: number | null = null
): PortfolioHistoryPoint => ({ date, total_stars, repo_count, stars_gained });

/**
 * 清單成員不變時，後端的 stars_gained 就等於總星數相減——用它補齊沒有明寫的點，
 * 讓只關心「缺口、今天、四捨五入」的測試不必每筆手算。要模擬成員變動的測試自己帶 stars_gained。
 */
const chain = (points: PortfolioHistoryPoint[]): PortfolioHistoryPoint[] =>
  points.map((pt, i) =>
    i === 0 || pt.stars_gained !== null
      ? pt
      : { ...pt, stars_gained: pt.total_stars - points[i - 1].total_stars }
  );

// 真實資料
const REAL = chain([
  p("2026-08-15", 8308807, 96),
  p("2026-08-16", 8326540),
  p("2026-08-18", 8362456),
  p("2026-08-21", 8411835),
  p("2026-08-22", 8415280),
]);

describe("computeDailyStars", () => {
  it("連續兩天之間就是當天的新增量", () => {
    const { bars } = computeDailyStars(
      chain([p("2026-08-15", 1000), p("2026-08-16", 1250)]),
      7,
      "2026-08-20"
    );

    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ date: "2026-08-16", stars: 250, spanDays: 1 });
  });

  it("隔了幾天才量到一次時攤成日均，而不是整筆算在最後一天", () => {
    // 整筆算在 8/18 會畫出 17,733 → 35,916 的假暴衝，
    // 攤平後是 17,733 → 17,958，才是真的平穩
    const { bars } = computeDailyStars(REAL.slice(0, 3), 7, "2026-08-22");

    expect(bars.map((b) => [b.date, b.stars])).toEqual([
      ["2026-08-16", 17733],
      ["2026-08-17", 17958],
      ["2026-08-18", 17958],
    ]);
  });

  it("攤出來的那幾天標記 spanDays，實際量到的那天是 1", () => {
    const { bars, hasEstimates } = computeDailyStars(REAL.slice(0, 3), 7, "2026-08-22");

    expect(bars.map((b) => b.spanDays)).toEqual([1, 2, 2]);
    expect(hasEstimates).toBe(true);
  });

  it("每天都量到時不會謊稱有推估", () => {
    const { hasEstimates } = computeDailyStars(
      chain([p("2026-08-15", 1000), p("2026-08-16", 1100), p("2026-08-17", 1200)]),
      7,
      "2026-08-20"
    );

    expect(hasEstimates).toBe(false);
  });

  it("只有今天那根標成未完成——否則每天最右邊都會看起來像崩盤", () => {
    // 8/21→8/22 只增 3,445，前幾天都是 17K 起跳，因為今天才過了八小時
    const { bars } = computeDailyStars(REAL, 7, "2026-08-22");

    expect(bars.filter((b) => b.partial).map((b) => b.date)).toEqual(["2026-08-22"]);
    expect(bars[bars.length - 1]).toMatchObject({ date: "2026-08-22", stars: 3445, partial: true });
  });

  it("今天還沒抓到快照時，沒有任何一根被標成未完成", () => {
    const { bars } = computeDailyStars(REAL, 7, "2026-08-25");

    expect(bars.some((b) => b.partial)).toBe(false);
  });

  it("新加入的 repo 不算成長：增量取後端的 stars_gained，不用總星數相減", () => {
    // 9/21 加入 rtk-ai/rtk（本來就有 81,240 星）：總星數相減會畫出 +87,998，實際只漲 6,758
    const { bars, totalGained } = computeDailyStars(
      [p("2026-09-20", 8765538, 96), p("2026-09-21", 8853536, 97, 6758)],
      7,
      "2026-09-25"
    );

    expect(bars.map((b) => b.stars)).toEqual([6758]);
    expect(totalGained).toBe(6758);
  });

  it("取消追蹤也不算成長下降", () => {
    const { bars, totalGained } = computeDailyStars(
      [p("2026-08-15", 8309000, 96), p("2026-08-16", 8300100, 95, 100)],
      7,
      "2026-08-20"
    );

    expect(bars[0].stars).toBe(100);
    expect(totalGained).toBe(100);
  });

  it("總增加量加總原始的 stars_gained，不受日均四捨五入影響", () => {
    const { totalGained, bars } = computeDailyStars(REAL, 7, "2026-08-22");
    const sumOfBars = bars.reduce((s, b) => s + b.stars, 0);

    expect(totalGained).toBe(106473);
    expect(sumOfBars).not.toBe(totalGained); // 四捨五入確實會差
  });

  it("後端沒給 stars_gained 的區間不畫長條，而不是當成 0", () => {
    const { bars, totalGained } = computeDailyStars(
      [p("2026-08-15", 1000), p("2026-08-16", 1100), p("2026-08-17", 1150, 94, 50)],
      7,
      "2026-08-20"
    );

    expect(bars.map((b) => [b.date, b.stars])).toEqual([["2026-08-17", 50]]);
    expect(totalGained).toBe(50);
  });

  it("sidecar 還是舊版、沒送 stars_gained 時也不畫，而不是算出 NaN", () => {
    // dev 模式下 Vite 先熱更新前端，sidecar 可能還沒重啟
    const legacy = [
      { date: "2026-08-15", total_stars: 1000, repo_count: 94 },
      { date: "2026-08-16", total_stars: 1100, repo_count: 94 },
    ] as unknown as PortfolioHistoryPoint[];

    const { bars, totalGained } = computeDailyStars(legacy, 7, "2026-08-20");

    expect(bars).toEqual([]);
    expect(totalGained).toBe(0);
  });

  it("總星數下降時給出負的長條，不是當成沒變", () => {
    const { bars, totalGained } = computeDailyStars(
      chain([p("2026-08-15", 1000), p("2026-08-16", 940)]),
      7,
      "2026-08-20"
    );

    expect(bars[0].stars).toBe(-60);
    expect(totalGained).toBe(-60);
  });

  it("同一天出現兩筆快照時跳過，不產生 Infinity", () => {
    const { bars, totalGained } = computeDailyStars(
      chain([p("2026-08-15", 1000), p("2026-08-15", 1010), p("2026-08-16", 1100)]),
      7,
      "2026-08-20"
    );

    expect(bars.every((b) => Number.isFinite(b.stars))).toBe(true);
    expect(bars.map((b) => [b.date, b.stars])).toEqual([["2026-08-16", 90]]);
    // 跳過的那段也不能算進總數，否則標題的總增加量跟長條對不起來
    expect(totalGained).toBe(90);
  });

  it("資料不足兩筆時沒有長條可畫，也不報總增加量", () => {
    expect(computeDailyStars([], 7, "2026-08-20")).toMatchObject({
      bars: [],
      coverageDays: 0,
      totalGained: 0,
    });
    expect(computeDailyStars([p("2026-08-15", 1000)], 7, "2026-08-20")).toMatchObject({
      bars: [],
      totalGained: 0,
    });
  });

  it("涵蓋天數回報實際有的天數，不是使用者選的範圍", () => {
    // 選 30 天但只有 8/15 起的資料——按鈕不該假裝畫出了 30 天
    const r = computeDailyStars(REAL, 30, "2026-08-22");

    expect(r.requestedDays).toBe(30);
    expect(r.coverageDays).toBe(7);
  });
});

describe("starAxisTicks", () => {
  const bar = (stars: number) => ({
    date: "2026-08-16",
    stars,
    spanDays: 1,
    partial: false,
  });

  it("刻度間距一致——交給 Recharts 會切出 0/5K/9K/14K/18K 這種忽大忽小的標籤", () => {
    const ticks = starAxisTicks([bar(17958), bar(17733), bar(3445)]);

    expect(ticks).toEqual([0, 5000, 10000, 15000, 20000]);
    const gaps = ticks.slice(1).map((v, i) => v - ticks[i]);
    expect(new Set(gaps).size).toBe(1);
  });

  it("一律包含 0，增量圖的基準線不能浮起來", () => {
    expect(starAxisTicks([bar(9000), bar(9500)])).toContain(0);
  });

  it("有負值時往下延伸，且仍然跨過 0", () => {
    const ticks = starAxisTicks([bar(-4000), bar(8000)]);

    expect(Math.min(...ticks)).toBeLessThanOrEqual(-4000);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(8000);
    expect(ticks).toContain(0);
  });

  it("刻度是整數，浮點累加不會留下小數尾巴", () => {
    expect(starAxisTicks([bar(17958)]).every(Number.isInteger)).toBe(true);
  });

  it("全部為零時仍給得出刻度，不會除以零或無限迴圈", () => {
    const ticks = starAxisTicks([bar(0), bar(0)]);

    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks).toContain(0);
  });
});
