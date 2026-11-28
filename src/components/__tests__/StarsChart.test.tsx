/**
 * Unit tests for StarsChart component
 */

import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { StarsChart } from "../StarsChart";
import * as apiClient from "../../api/client";
import { createTestQueryClient, queryKeys } from "../../lib/react-query";
import { translations } from "../../i18n/translations";

// Mock API client
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getStarsChart: vi.fn(),
    getBackfillStatus: vi.fn().mockResolvedValue({ can_backfill: false }),
    backfillStarHistory: vi.fn(),
  };
});

// Mock format utils
vi.mock("../../utils/format", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/format")>();
  return {
    ...actual,
    formatNumber: vi.fn((num: number) => {
      if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
      return num.toString();
    }),
    formatChartDate: vi.fn((dateStr: string) => {
      const date = new Date(dateStr);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    }),
  };
});

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function renderWithClient(ui: ReactElement) {
  const client = createTestQueryClient();
  return render(createElement(QueryClientProvider, { client }, ui));
}

describe("StarsChart", () => {
  const mockChartData = {
    repo_id: 1,
    repo_name: "facebook/react",
    time_range: "30d",
    data_points: [
      { date: "2024-01-01T00:00:00Z", stars: 220000, forks: 30000, open_issues: 0 },
      { date: "2024-01-08T00:00:00Z", stars: 220500, forks: 30100, open_issues: 0 },
      { date: "2024-01-15T00:00:00Z", stars: 221000, forks: 30200, open_issues: 0 },
      { date: "2024-01-22T00:00:00Z", stars: 221500, forks: 30300, open_issues: 0 },
      { date: "2024-01-29T00:00:00Z", stars: 222000, forks: 30400, open_issues: 0 },
    ],
    min_stars: 220000,
    max_stars: 222000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks 不重設回傳值：個別測試改過的回填狀態不能漏到後面
    vi.mocked(apiClient.getBackfillStatus).mockResolvedValue({ can_backfill: false } as never);
    // clearAllMocks 不清 mock*Once 的佇列：一條沒用完的 once 會漏到後面
    vi.mocked(apiClient.getStarsChart).mockReset();
  });

  it("shows loading state initially", () => {
    vi.mocked(apiClient.getStarsChart).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    renderWithClient(<StarsChart repoId={1} />);

    expect(screen.getByText("Loading chart...")).toBeInTheDocument();
    expect(screen.getByText("Loading chart...")).toHaveClass("chart-loading");
    // 讀取中也能換範圍
    expect(screen.getByRole("button", { name: "7d" })).toBeInTheDocument();
  });

  it("displays chart when data is loaded", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue(mockChartData);

    renderWithClient(<StarsChart repoId={1} />);

    await waitFor(() => {
      expect(screen.queryByText("Loading chart...")).not.toBeInTheDocument();
    });

    // 讀到了、沒有失敗：不能說沒有更新成功（通知是下一輪才送，等一下再看）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByText(translations.en.chart.refreshFailed)).not.toBeInTheDocument();

    // Chart controls should be visible
    expect(screen.getByRole("button", { name: "7d" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30d" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "90d" })).toBeInTheDocument();
  });

  it("shows error message when API call fails", async () => {
    vi.mocked(apiClient.getStarsChart).mockRejectedValue(new Error("Network error"));

    renderWithClient(<StarsChart repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Chart loading failed", { exact: false })).toBeInTheDocument();
    });
    // 後端的原字不上畫面
    expect(screen.queryByText("Network error", { exact: false })).not.toBeInTheDocument();

    // 驗證 retry 按鈕存在
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("keeps the retry button while retrying a chart that never loaded", async () => {
    // 還沒有資料時重試，isLoading 又是 true：拿它當閘門的話主體換成讀取中，重試鈕消失、焦點掉回 body
    vi.mocked(apiClient.getStarsChart)
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementationOnce(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderWithClient(<StarsChart repoId={1} />);
    await screen.findByText(translations.en.chart.loadFailed);
    const retry = screen.getByRole("button", { name: translations.en.common.retry });

    await user.click(retry);

    // 同一顆按鈕、焦點留在上面：換成另一個分支重掛的話，鍵盤與螢幕閱讀器的使用者會失去位置
    const retrying = await screen.findByRole("button", { name: translations.en.common.retrying });
    expect(retrying).toBe(retry);
    expect(retrying).toHaveFocus();
    expect(screen.queryByText("Loading chart...")).not.toBeInTheDocument();
  });

  it("keeps the chart and says it could not update when a reread fails", async () => {
    // 回填失敗或逾時之後會重讀整個 repo 的圖表：讀不到時不能把已經畫好的圖換成錯誤
    const client = createTestQueryClient();
    vi.mocked(apiClient.getStarsChart)
      .mockResolvedValueOnce(mockChartData)
      .mockRejectedValueOnce(new Error("boom"));
    const { container } = render(
      createElement(QueryClientProvider, { client }, <StarsChart repoId={1} />)
    );
    await waitFor(() =>
      expect(container.querySelector(".recharts-responsive-container")).toBeInTheDocument()
    );

    await act(async () => {
      await client.refetchQueries({ queryKey: queryKeys.starsChart.repo(1) });
    });

    expect(await screen.findByText(translations.en.chart.refreshFailed)).toBeInTheDocument();
    expect(container.querySelector(".recharts-responsive-container")).toBeInTheDocument();
    expect(screen.queryByText(translations.en.chart.loadFailed)).not.toBeInTheDocument();
  });

  it("retries a failed reread from the same row and drops the notice once it works", async () => {
    const client = createTestQueryClient();
    let finishRetry: (v: unknown) => void = () => {};
    vi.mocked(apiClient.getStarsChart)
      .mockResolvedValueOnce(mockChartData)
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementationOnce(() => new Promise((resolve) => (finishRetry = resolve)) as never);
    const user = userEvent.setup();
    const { container } = render(
      createElement(QueryClientProvider, { client }, <StarsChart repoId={1} />)
    );
    await waitFor(() =>
      expect(container.querySelector(".recharts-responsive-container")).toBeInTheDocument()
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: queryKeys.starsChart.repo(1) });
    });
    await screen.findByText(translations.en.chart.refreshFailed);
    const retry = screen.getByRole("button", { name: translations.en.common.retry });

    await user.click(retry);

    const retrying = await screen.findByRole("button", { name: translations.en.common.retrying });
    expect(retrying).toBe(retry);
    await act(async () => {
      finishRetry(mockChartData);
    });
    await waitFor(() =>
      expect(screen.queryByText(translations.en.chart.refreshFailed)).not.toBeInTheDocument()
    );
  });

  it("keeps the time range buttons when the chart fails to load, so another range can be tried", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getStarsChart).mockImplementation((_id, range) =>
      range === "30d" ? Promise.reject(new Error("boom")) : Promise.resolve(mockChartData)
    );

    renderWithClient(<StarsChart repoId={1} />);
    await screen.findByText("Chart loading failed", { exact: false });

    await user.click(screen.getByRole("button", { name: "7d" }));

    await waitFor(() => {
      expect(screen.queryByText("Chart loading failed", { exact: false })).not.toBeInTheDocument();
    });
    expect(apiClient.getStarsChart).toHaveBeenCalledWith(1, "7d", expect.anything());
  });

  it("keeps the backfill result on screen when the chart goes from too little data to a chart", async () => {
    // 回填區塊在每種狀態都留在同一個位置：圖表從資料不足變成有圖表時不卸載重掛，剛顯示的說明才不會消失
    const user = userEvent.setup();
    vi.mocked(apiClient.getBackfillStatus).mockResolvedValue({
      repo_id: 1,
      repo_name: "facebook/react",
      can_backfill: true,
      current_stars: 100,
      max_stars_allowed: 5000,
      has_backfilled_data: false,
      backfilled_days: 0,
      message: "",
    });
    vi.mocked(apiClient.backfillStarHistory).mockResolvedValue({
      repo_id: 1,
      repo_name: "facebook/react",
      success: true,
      total_stargazers: 100,
      snapshots_created: 3,
      earliest_date: "2024-01-01",
      latest_date: "2024-01-03",
      message: "",
      code: null,
    });
    vi.mocked(apiClient.getStarsChart)
      .mockResolvedValueOnce({ ...mockChartData, data_points: [mockChartData.data_points[0]] })
      .mockResolvedValue(mockChartData);

    renderWithClient(<StarsChart repoId={1} currentStars={100} />);
    await screen.findByText(/Insufficient data/);

    await user.click(await screen.findByRole("button", { name: "Backfill History" }));

    await waitFor(() => {
      expect(screen.queryByText(/Insufficient data/)).not.toBeInTheDocument();
    });
    expect(screen.getByText("Backfill complete! Created 3 data points.")).toBeInTheDocument();
  });

  it("keeps the backfill result on screen while another time range loads", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getBackfillStatus).mockResolvedValue({
      repo_id: 1,
      repo_name: "facebook/react",
      can_backfill: true,
      current_stars: 100,
      max_stars_allowed: 5000,
      has_backfilled_data: false,
      backfilled_days: 0,
      message: "",
    });
    vi.mocked(apiClient.backfillStarHistory).mockResolvedValue({
      repo_id: 1,
      repo_name: "facebook/react",
      success: true,
      total_stargazers: 100,
      snapshots_created: 3,
      earliest_date: "2024-01-01",
      latest_date: "2024-01-03",
      message: "",
      code: null,
    });
    vi.mocked(apiClient.getStarsChart).mockImplementation((_id, range) =>
      range === "30d" ? Promise.resolve(mockChartData) : new Promise(() => {})
    );

    renderWithClient(<StarsChart repoId={1} currentStars={100} />);
    await user.click(await screen.findByRole("button", { name: "Backfill History" }));
    await screen.findByText("Backfill complete! Created 3 data points.");

    await user.click(screen.getByRole("button", { name: "7d" }));

    await screen.findByText("Loading chart...");
    expect(screen.getByText("Backfill complete! Created 3 data points.")).toBeInTheDocument();
  });

  it("does not carry a backfill result over to another repository", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getBackfillStatus).mockResolvedValue({
      repo_id: 1,
      repo_name: "facebook/react",
      can_backfill: true,
      current_stars: 100,
      max_stars_allowed: 5000,
      has_backfilled_data: false,
      backfilled_days: 0,
      message: "",
    });
    vi.mocked(apiClient.backfillStarHistory).mockRejectedValue(new apiClient.ApiError(500, "boom"));
    vi.mocked(apiClient.getStarsChart).mockResolvedValue(mockChartData);
    const client = createTestQueryClient();
    const { rerender } = render(
      createElement(QueryClientProvider, { client }, <StarsChart repoId={1} currentStars={100} />)
    );
    await user.click(await screen.findByRole("button", { name: "Backfill History" }));
    await screen.findByText("Not backfilled.", { exact: false });

    // 虛擬清單重排後同一個元件會換成別的 repo
    rerender(
      createElement(QueryClientProvider, { client }, <StarsChart repoId={2} currentStars={100} />)
    );

    // 換過去之後回填狀態要重讀，先顯示「檢查中」（說明本來就不在）：等 repo 2 的狀態讀回、回填鈕回來再看
    await waitFor(() => expect(apiClient.getBackfillStatus).toHaveBeenCalledWith(2));
    await screen.findByRole("button", { name: "Backfill History" });
    expect(screen.queryByText("Not backfilled.", { exact: false })).not.toBeInTheDocument();
  });

  it("shows empty state when data has less than 2 points", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue({
      ...mockChartData,
      data_points: [{ date: "2024-01-01T00:00:00Z", stars: 220000, forks: 30000, open_issues: 0 }],
    });

    renderWithClient(<StarsChart repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText(/Insufficient data/)).toBeInTheDocument();
    });
    // 資料不足時也能換範圍（「全部」讀的是另一個端點，可能就有資料）
    expect(screen.getByRole("button", { name: "7d" })).toBeInTheDocument();
  });

  it("fetches chart data with default 30d time range", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue(mockChartData);

    renderWithClient(<StarsChart repoId={1} />);

    await waitFor(() => {
      expect(apiClient.getStarsChart).toHaveBeenCalledWith(1, "30d", expect.any(AbortSignal));
    });
  });

  it("changes time range when clicking range buttons", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getStarsChart).mockResolvedValue(mockChartData);

    renderWithClient(<StarsChart repoId={1} />);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "30d" })).toBeInTheDocument();
    });

    // Click on 7d button
    const sevenDayButton = screen.getByRole("button", { name: "7d" });
    await user.click(sevenDayButton);

    await waitFor(() => {
      expect(apiClient.getStarsChart).toHaveBeenCalledWith(1, "7d", expect.any(AbortSignal));
    });

    // Click on 90d button
    const ninetyDayButton = screen.getByRole("button", { name: "90d" });
    await user.click(ninetyDayButton);

    await waitFor(() => {
      expect(apiClient.getStarsChart).toHaveBeenCalledWith(1, "90d", expect.any(AbortSignal));
    });
  });

  it("highlights active time range button", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue(mockChartData);

    renderWithClient(<StarsChart repoId={1} />);

    await waitFor(() => {
      const thirtyDayButton = screen.getByRole("button", { name: "30d" });
      expect(thirtyDayButton).toHaveClass("active");
    });

    const sevenDayButton = screen.getByRole("button", { name: "7d" });
    expect(sevenDayButton).not.toHaveClass("active");
  });

  it("renders chart container after data loads", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue(mockChartData);

    const { container } = renderWithClient(<StarsChart repoId={1} />);

    await waitFor(() => {
      expect(screen.queryByText("Loading chart...")).not.toBeInTheDocument();
    });

    const chartContainer = container.querySelector(".stars-chart");
    expect(chartContainer).toBeInTheDocument();
  });

  it("aborts the in-flight request on unmount", async () => {
    // 舊版斷言驗的是 React 18 已移除的 console 警告（恆空集合、永不可能失敗）。
    // 真正要守的行為：queryFn 的 AbortSignal 有接進 API 呼叫，unmount 即取消。
    const captured: { signal?: AbortSignal } = {};
    vi.mocked(apiClient.getStarsChart).mockImplementation((_id, _range, signal) => {
      captured.signal = signal ?? undefined;
      return new Promise(() => {}); // 永不 resolve，模擬 in-flight
    });

    const { unmount } = renderWithClient(<StarsChart repoId={1} />);

    await waitFor(() => expect(captured.signal).toBeDefined());
    expect(captured.signal?.aborted).toBe(false);

    unmount();

    await waitFor(() => expect(captured.signal?.aborted).toBe(true));
  });

  it("refetches data when repo ID changes", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue(mockChartData);

    const wrapper = createWrapper();
    const { rerender } = render(<StarsChart repoId={1} />, { wrapper });

    await waitFor(() => {
      expect(apiClient.getStarsChart).toHaveBeenCalledWith(1, "30d", expect.any(AbortSignal));
    });

    // Change repo ID
    rerender(<StarsChart repoId={2} />);

    await waitFor(() => {
      expect(apiClient.getStarsChart).toHaveBeenCalledWith(2, "30d", expect.any(AbortSignal));
    });

    // Should have been called twice (once for each repo)
    expect(apiClient.getStarsChart).toHaveBeenCalledTimes(2);
  });
});
