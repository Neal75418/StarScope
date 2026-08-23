/**
 * 訊號焦點的空狀態。
 *
 * 2026-08-23 之前，早期訊號偵測器從來沒有被呼叫過——early_signals 表歷史總筆數
 * 是 0。接上線路之後畫面**完全沒有變化**，因為這個元件在沒有訊號時直接
 * `return null`：「偵測器沒被呼叫」與「跑過但沒東西」長得一模一樣，而使用者
 * 唯一合理的推論是功能壞了。
 *
 * 這裡守的是那個區分。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SignalSpotlight } from "../SignalSpotlight";
import type { SignalSummary } from "../../../api/types";

const summary = (over: Partial<SignalSummary> = {}): SignalSummary => ({
  total_active: 0,
  by_type: {},
  by_severity: {},
  repos_with_signals: 0,
  snapshot_days_covered: 40,
  ...over,
});

describe("SignalSpotlight 的空狀態", () => {
  it("沒有訊號時仍然說「檢查過了」，而不是整個消失", () => {
    render(
      <SignalSpotlight signals={[]} summary={summary()} totalRepos={94} onAcknowledge={vi.fn()} />
    );

    expect(screen.getByTestId("signal-spotlight-empty")).toBeInTheDocument();
    // 涵蓋範圍要講出來——「沒事」的可信度取決於檢查了多少東西
    expect(screen.getByTestId("signal-spotlight-empty")).toHaveTextContent("94");
  });

  it("快照不足 30 天時說明突破偵測還沒到期", () => {
    // breakout 需要 stars_delta_30d，而那需要 30 天前的快照。少了這句，
    // 使用者無法分辨「這功能對我沒用」與「還沒到能判斷的時候」。
    render(
      <SignalSpotlight
        signals={[]}
        summary={summary({ snapshot_days_covered: 6 })}
        totalRepos={94}
        onAcknowledge={vi.fn()}
      />
    );

    const el = screen.getByTestId("signal-spotlight-empty");
    expect(el).toHaveTextContent("30");
    expect(el).toHaveTextContent("6");
  });

  it("快照足夠時不再提暖機，否則那句話會永遠掛著", () => {
    render(
      <SignalSpotlight
        signals={[]}
        summary={summary({ snapshot_days_covered: 30 })}
        totalRepos={94}
        onAcknowledge={vi.fn()}
      />
    );

    expect(screen.getByTestId("signal-spotlight-empty")).not.toHaveTextContent(
      /30 天快照|30 days of snapshots/
    );
  });

  it("摘要還沒載到時什麼都不說——不知道有沒有訊號，不能宣稱沒事", () => {
    const { container } = render(
      <SignalSpotlight signals={[]} summary={null} totalRepos={94} onAcknowledge={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("有訊號時走原本的路徑，不顯示空狀態", () => {
    render(
      <SignalSpotlight
        signals={[]}
        summary={summary({ total_active: 3, by_type: { breakout: 3 } })}
        totalRepos={94}
        onAcknowledge={vi.fn()}
      />
    );
    expect(screen.queryByTestId("signal-spotlight-empty")).not.toBeInTheDocument();
    // 標題旁的總數（3）與類型 chip 的計數（也是 3）會各出現一次，
    // 所以用 getAllByText 而不是 getByText——後者會因為找到兩個而失敗
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
  });
});
