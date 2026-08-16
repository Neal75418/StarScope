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
    // 實測案例：+574 在 18k 上是真的在飛，+431 在 218k 上是雜訊
    const result = computeMovers([
      repo({ id: 1, stars: 19025, stars_delta_1d: 574 }),
      repo({ id: 2, stars: 218707, stars_delta_1d: 431 }),
    ]);
    expect(result.risers[0].repo.id).toBe(1);
  });
});

describe("computeMovers 的門檻與取樣", () => {
  it("門檻是中位數的十倍，母體含零與負值", () => {
    const repos = [
      repo({ id: 1, stars: 1100, stars_delta_1d: 100 }),
      repo({ id: 2, stars: 1000, stars_delta_1d: 0 }),
      repo({ id: 3, stars: 1000, stars_delta_1d: 0 }),
      repo({ id: 4, stars: 990, stars_delta_1d: -10 }),
    ];
    // 相對值排序後為 [-0.01, 0, 0, 0.1]，中位數 0 → 不畫線
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

  it("最多五個，只取正成長", () => {
    const repos = Array.from({ length: 8 }, (_, i) =>
      repo({ id: i + 1, stars: 1000 + (i + 1) * 10, stars_delta_1d: (i + 1) * 10 })
    );
    repos.push(repo({ id: 99, stars: 990, stars_delta_1d: -10 }));

    const result = computeMovers(repos);
    expect(result.risers).toHaveLength(5);
    expect(result.risers.every((m) => m.relative > 0)).toBe(true);
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
