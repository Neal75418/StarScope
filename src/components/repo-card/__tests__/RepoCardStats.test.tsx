import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RepoCardStats } from "../RepoCardStats";
import type { RepoWithSignals } from "../../../api/client";

function makeRepo(overrides: Partial<RepoWithSignals> = {}): RepoWithSignals {
  return {
    id: 1,
    owner: "facebook",
    name: "react",
    full_name: "facebook/react",
    url: "https://github.com/facebook/react",
    description: "A JavaScript library",
    language: "JavaScript",
    added_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-06-01T00:00:00Z",
    stars: 200000,
    forks: 40000,
    stars_delta_1d: 70,
    stars_delta_7d: 500,
    stars_delta_30d: 2000,
    velocity: 71.4,
    acceleration: 5.2,
    trend: 1,
    forks_delta_7d: null,
    forks_delta_30d: null,
    issues_delta_7d: null,
    issues_delta_30d: null,
    last_fetched: "2024-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("RepoCardStats", () => {
  it("renders star count", () => {
    render(<RepoCardStats repo={makeRepo()} />);
    expect(screen.getByText("200.0K")).toBeInTheDocument();
  });

  it("renders 7d and 30d deltas", () => {
    render(<RepoCardStats repo={makeRepo()} />);
    expect(screen.getByText("+500")).toBeInTheDocument();
    expect(screen.getByText("+2.0K")).toBeInTheDocument();
  });

  it("renders velocity", () => {
    render(<RepoCardStats repo={makeRepo()} />);
    expect(screen.getByText("71.4/day")).toBeInTheDocument();
  });

  it("以期初星數算相對變化，不是用現在的星數", () => {
    // deepseek-harness 的真實數字：113,968 → 182,687，七天 +68,719。
    // 期初當分母是 +60.3%，拿現在的 182,687 當分母只有 +37.6%——
    // 兩個基期差得夠遠，這條才分辨得出用錯分母
    render(<RepoCardStats repo={makeRepo({ stars: 182687, stars_delta_7d: 68719 })} />);

    expect(screen.getByText("+60.3%")).toBeInTheDocument();
    expect(screen.queryByText("+37.6%")).not.toBeInTheDocument();
  });

  it("displays dash for null values", () => {
    render(
      <RepoCardStats
        repo={makeRepo({ stars: null, stars_delta_7d: null, velocity: null, trend: null })}
      />
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(4);
  });

  // 以下三條斷言 class 而不是實際顏色：jsdom 不處理 CSS，取不到 computed color。
  // class 對應到的顏色是在 Chrome 裡量過的（正 #3fb950、負 #f85149、中性灰）。
  describe("增量的顏色由值決定", () => {
    it("負成長不能是綠色——pathwaycom/pathway 掉了 58 顆星卻顯示綠字", () => {
      render(<RepoCardStats repo={makeRepo({ stars: 62458, stars_delta_7d: -58 })} />);

      expect(screen.getByText("-58")).toHaveClass("delta-negative");
    });

    it("正成長是正向色", () => {
      render(<RepoCardStats repo={makeRepo()} />);

      expect(screen.getByText("+500")).toHaveClass("delta-positive");
    });

    it("沒有資料不能被畫成正成長——「—」原本跟「+500」同一個綠", () => {
      render(<RepoCardStats repo={makeRepo({ stars_delta_30d: null })} />);

      const dash = screen.getAllByText("—")[0];
      expect(dash).toHaveClass("delta-neutral");
      expect(dash).not.toHaveClass("delta-positive");
    });

    it("零沒有方向，用中性色而不是正向色", () => {
      render(<RepoCardStats repo={makeRepo({ stars_delta_7d: 0 })} />);

      expect(screen.getByText("0")).toHaveClass("delta-neutral");
    });
  });
});
