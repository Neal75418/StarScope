/**
 * 健康分數的三種狀態必須分得開：沒有 repo、有 repo 但還算不出來、算得出來。
 *
 * 中間那個狀態原本不存在——score 為 null 時一律顯示「新增 repo 後即可查看健康分數」，
 * 而實測時使用者有 94 個 repo，看到那句話只會以為壞掉了。
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortfolioHealthScore, HealthScoreInput } from "../PortfolioHealthScore";

function makeInput(overrides: Partial<HealthScoreInput> = {}): HealthScoreInput {
  return {
    score: 80,
    activeAlerts: 0,
    totalRepos: 10,
    reposWithSignals: 3,
    highVelocityRepos: 2,
    staleRepos: 1,
    reposAwaitingHistory: 0,
    ...overrides,
  };
}

// 測試環境的 i18n 走英文文案（src/test/setup.ts 的全域 mock），
// 斷言必須用英文字串——拿中文去比只會因為找不到而「通過」。
const ADD_REPOS = /Add repos/i;

describe("PortfolioHealthScore", () => {
  it("tells an empty watchlist to add repos", () => {
    render(<PortfolioHealthScore input={makeInput({ score: null, totalRepos: 0 })} />);

    expect(screen.getByText(ADD_REPOS)).toBeInTheDocument();
  });

  it("tells a full watchlist that history is still building, not to add repos", () => {
    render(
      <PortfolioHealthScore
        input={makeInput({ score: null, totalRepos: 94, reposAwaitingHistory: 94 })}
      />
    );

    const message = screen.getByTestId("health-awaiting-history");
    // 有 94 個 repo 的人不該被叫去新增 repo
    expect(screen.queryByText(ADD_REPOS)).not.toBeInTheDocument();
    expect(message).toHaveTextContent("94");
  });

  it("shows the stale count against what could actually be measured", () => {
    // 20 個量得到、其中 5 個停滯，另外 74 個還沒有歷史。
    // 只印「5」會被讀成「94 個裡有 5 個停滯」，把分母講清楚才對得上。
    render(
      <PortfolioHealthScore
        input={makeInput({ score: 70, totalRepos: 94, staleRepos: 5, reposAwaitingHistory: 74 })}
      />
    );

    expect(screen.getByText("5/20")).toBeInTheDocument();
    expect(screen.getByTestId("health-awaiting-count")).toHaveTextContent("74");
  });

  it("drops the awaiting-history row once every repo can be measured", () => {
    render(<PortfolioHealthScore input={makeInput({ reposAwaitingHistory: 0 })} />);

    expect(screen.queryByTestId("health-awaiting-count")).not.toBeInTheDocument();
  });
});
