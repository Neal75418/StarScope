import { describe, it, expect } from "vitest";
import { computeMovers } from "../movers";
import type { RepoWithSignals } from "../../api/types";

function repo(over: Partial<RepoWithSignals> & { id: number }): RepoWithSignals {
  return {
    owner: "o",
    name: `r${over.id}`,
    full_name: `o/r${over.id}`,
    url: "",
    description: null,
    language: null,
    added_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    stars: 1000,
    forks: 0,
    stars_delta_1d: null,
    stars_delta_7d: null,
    stars_delta_30d: null,
    velocity: null,
    acceleration: null,
    trend: 0,
    forks_delta_7d: null,
    forks_delta_30d: null,
    issues_delta_7d: null,
    issues_delta_30d: null,
    last_fetched: "2026-08-01T00:00:00Z",
    ...over,
  } as RepoWithSignals;
}

describe("computeMovers 的窗口選擇", () => {
  it("沒有任何差值時回 null 窗口", () => {
    expect(computeMovers([repo({ id: 1 })]).window).toBeNull();
  });

  it("只有單日資料時用單日", () => {
    expect(computeMovers([repo({ id: 1, stars_delta_1d: 5 })]).window).toBe(1);
  });

  it("七日涵蓋數 >= 單日時切到七日", () => {
    const result = computeMovers([
      repo({ id: 1, stars_delta_1d: 5, stars_delta_7d: 30 }),
      repo({ id: 2, stars_delta_1d: 5, stars_delta_7d: 30 }),
    ]);
    expect(result.window).toBe(7);
  });

  it("七日涵蓋數少於單日時仍留在單日", () => {
    // 8/22 當天可能只有少數 repo 補齊七日資料，排行榜不該因此縮成一列
    const result = computeMovers([
      repo({ id: 1, stars_delta_1d: 5, stars_delta_7d: 30 }),
      repo({ id: 2, stars_delta_1d: 5 }),
      repo({ id: 3, stars_delta_1d: 5 }),
    ]);
    expect(result.window).toBe(1);
  });
});

describe("computeMovers 的相對成長", () => {
  it("用成長前的星數當分母", () => {
    // 現在 1000 顆、漲了 100 → 基期是 900，不是 1000
    const [top] = computeMovers([repo({ id: 1, stars: 1000, stars_delta_1d: 100 })]).risers;
    expect(top.relative).toBeCloseTo(100 / 900, 6);
  });

  it("基期為 0 的 repo 不參與排行", () => {
    // 從 0 顆漲到 5 顆是無限大成長，會永遠霸佔第一名
    const result = computeMovers([repo({ id: 1, stars: 5, stars_delta_1d: 5 })]);
    expect(result.risers).toHaveLength(0);
  });

  it("相對成長會把絕對值排序的錯誤翻正", () => {
    // 兩種排法必須給出不同答案，這條測試才擋得住有人改回絕對值：
    // 絕對值排序會把 B 放前面（500 > 200），相對成長排序把 A 放前面（4.17% vs 0.25%）
    const result = computeMovers([
      repo({ id: 1, stars: 5000, stars_delta_1d: 200 }),
      repo({ id: 2, stars: 200000, stars_delta_1d: 500 }),
    ]);
    expect(result.risers[0].repo.id).toBe(1);
    expect(result.risers[1].repo.id).toBe(2);
  });
});

describe("computeMovers 的門檻與取樣", () => {
  it("門檻是中位數的十倍，母體含零與負值", () => {
    // 非對稱資料：多個負值，一個正值。母體中位數會被負值拉負。
    // 若濾掉負值只看正值，中位數會變成正數，門檻會被啟用。
    // 這禁絕「把 filter(m => m.relative >= 0)」的突變。
    const repos = [
      repo({ id: 1, stars: 1100, stars_delta_1d: -100 }), // base=1200, relative=-100/1200=-0.0833
      repo({ id: 2, stars: 950, stars_delta_1d: -50 }), // base=1000, relative=-50/1000=-0.05
      repo({ id: 3, stars: 990, stars_delta_1d: -10 }), // base=1000, relative=-10/1000=-0.01
      repo({ id: 4, stars: 1010, stars_delta_1d: 10 }), // base=1000, relative=10/1000=0.01
    ];
    // 母體: [-0.0833, -0.05, -0.01, 0.01] → 中位數 (-0.05 + -0.01)/2 = -0.03 → threshold = null
    // 若只看 >= 0: [0.01] → 中位數 0.01 → threshold = 0.1 (不該這樣，會被測試抓到)
    expect(computeMovers(repos).threshold).toBeNull();
  });

  it("中位數大於零時門檻為其十倍", () => {
    const repos = [
      repo({ id: 1, stars: 1010, stars_delta_1d: 10 }),
      repo({ id: 2, stars: 1020, stars_delta_1d: 20 }),
      repo({ id: 3, stars: 1030, stars_delta_1d: 30 }),
    ];
    const median = 20 / 1000;
    expect(computeMovers(repos).threshold).toBeCloseTo(median * 10, 6);
  });

  it("最多五個，只取正成長，按相對值排序", () => {
    // 插入順序和相對值排序必須不同，這樣未排序的實作會失敗
    const repos = [
      repo({ id: 1, stars: 1050, stars_delta_1d: 50 }), // relative = 50/1000 = 0.05
      repo({ id: 2, stars: 1010, stars_delta_1d: 10 }), // relative = 10/1000 = 0.01
      repo({ id: 3, stars: 1040, stars_delta_1d: 40 }), // relative = 40/1000 = 0.04
      repo({ id: 4, stars: 1020, stars_delta_1d: 20 }), // relative = 20/1000 = 0.02
      repo({ id: 5, stars: 1030, stars_delta_1d: 30 }), // relative = 30/1000 = 0.03
      repo({ id: 6, stars: 1060, stars_delta_1d: 60 }), // relative = 60/1000 = 0.06
      repo({ id: 7, stars: 1015, stars_delta_1d: 15 }), // relative = 15/1000 = 0.015
      repo({ id: 99, stars: 990, stars_delta_1d: -10 }), // relative = -10/1000 = -0.01
    ];

    const result = computeMovers(repos);
    expect(result.risers).toHaveLength(5);
    expect(result.risers.every((m) => m.relative > 0)).toBe(true);
    // 按相對值排序（降冪）：0.06 > 0.05 > 0.04 > 0.03 > 0.02 = id [6, 1, 3, 5, 4]
    expect(result.risers.map((m) => m.repo.id)).toEqual([6, 1, 3, 5, 4]);
    expect(result.fallers.map((m) => m.repo.id)).toEqual([99]);
  });

  it("正成長不足五個時不用負值補位", () => {
    const result = computeMovers([
      repo({ id: 1, stars: 1010, stars_delta_1d: 10 }),
      repo({ id: 2, stars: 990, stars_delta_1d: -10 }),
    ]);
    expect(result.risers).toHaveLength(1);
  });

  it("回傳所選窗口的總增量", () => {
    const result = computeMovers([
      repo({ id: 1, stars: 1100, stars_delta_1d: 100 }),
      repo({ id: 2, stars: 950, stars_delta_1d: -50 }),
    ]);
    expect(result.totalDelta).toBe(50);
  });
});
