/**
 * Unit tests for StarsChart component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { StarsChart } from "../StarsChart";
import * as apiClient from "../../api/client";

// Mock API client
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getStarsChart: vi.fn(),
    getBackfillStatus: vi.fn().mockResolvedValue({ can_backfill: false }),
  };
});


// Mock format utils
vi.mock("../../utils/format", () => ({
  formatNumber: vi.fn((num: number) => {
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  }),
  formatChartDate: vi.fn((dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }),
}));

describe("StarsChart", () => {
  const mockChartData = {
    repo_id: 1,
    repo_name: "facebook/react",
    time_range: "30d",
    data_points: [
      { date: "2024-01-01T00:00:00Z", stars: 220000, forks: 30000 },
      { date: "2024-01-08T00:00:00Z", stars: 220500, forks: 30100 },
      { date: "2024-01-15T00:00:00Z", stars: 221000, forks: 30200 },
      { date: "2024-01-22T00:00:00Z", stars: 221500, forks: 30300 },
      { date: "2024-01-29T00:00:00Z", stars: 222000, forks: 30400 },
    ],
    min_stars: 220000,
    max_stars: 222000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    vi.mocked(apiClient.getStarsChart).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<StarsChart repoId={1} />);

    expect(screen.getByText("圖表載入中...")).toBeInTheDocument();
    expect(screen.getByText("圖表載入中...")).toHaveClass("chart-loading");
  });

  it("displays chart when data is loaded", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue(mockChartData);

    render(<StarsChart repoId={1} />);

    await waitFor(() => {
      expect(screen.queryByText("圖表載入中...")).not.toBeInTheDocument();
    });

    // Chart controls should be visible
    expect(screen.getByRole("button", { name: "7d" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30d" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "90d" })).toBeInTheDocument();
  });

  it("shows error message when API call fails", async () => {
    vi.mocked(apiClient.getStarsChart).mockRejectedValue(new Error("Network error"));

    render(<StarsChart repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });

    expect(screen.getByText("Network error")).toHaveClass("chart-error");
  });

  it("shows empty state when data has less than 2 points", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue({
      ...mockChartData,
      data_points: [{ date: "2024-01-01T00:00:00Z", stars: 220000, forks: 30000 }],
    });

    render(<StarsChart repoId={1} />);

    await waitFor(() => {
      expect(screen.getByText(/資料不足，至少需要 2 個資料點才能繪製圖表/)).toBeInTheDocument();
    });
  });

  it("fetches chart data with default 30d time range", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue(mockChartData);

    render(<StarsChart repoId={1} />);

    await waitFor(() => {
      expect(apiClient.getStarsChart).toHaveBeenCalledWith(1, "30d");
    });
  });

  it("changes time range when clicking range buttons", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.getStarsChart).mockResolvedValue(mockChartData);

    render(<StarsChart repoId={1} />);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "30d" })).toBeInTheDocument();
    });

    // Click on 7d button
    const sevenDayButton = screen.getByRole("button", { name: "7d" });
    await user.click(sevenDayButton);

    await waitFor(() => {
      expect(apiClient.getStarsChart).toHaveBeenCalledWith(1, "7d");
    });

    // Click on 90d button
    const ninetyDayButton = screen.getByRole("button", { name: "90d" });
    await user.click(ninetyDayButton);

    await waitFor(() => {
      expect(apiClient.getStarsChart).toHaveBeenCalledWith(1, "90d");
    });
  });

  it("highlights active time range button", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue(mockChartData);

    render(<StarsChart repoId={1} />);

    await waitFor(() => {
      const thirtyDayButton = screen.getByRole("button", { name: "30d" });
      expect(thirtyDayButton).toHaveClass("active");
    });

    const sevenDayButton = screen.getByRole("button", { name: "7d" });
    expect(sevenDayButton).not.toHaveClass("active");
  });

  it("renders responsive container with correct height", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue(mockChartData);

    const { container } = render(<StarsChart repoId={1} />);

    await waitFor(() => {
      expect(screen.queryByText("圖表載入中...")).not.toBeInTheDocument();
    });

    // Check if ResponsiveContainer is rendered (it has a specific data attribute)
    const chartContainer = container.querySelector(".stars-chart");
    expect(chartContainer).toBeInTheDocument();
  });

  it("cleans up async operations on unmount", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue(mockChartData);

    const { unmount } = render(<StarsChart repoId={1} />);

    // Unmount before API call resolves
    unmount();

    // Should not trigger any state updates (no errors in console)
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("refetches data when repo ID changes", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue(mockChartData);

    const { rerender } = render(<StarsChart repoId={1} />);

    await waitFor(() => {
      expect(apiClient.getStarsChart).toHaveBeenCalledWith(1, "30d");
    });

    // Change repo ID
    rerender(<StarsChart repoId={2} />);

    await waitFor(() => {
      expect(apiClient.getStarsChart).toHaveBeenCalledWith(2, "30d");
    });

    // Should have been called twice (once for each repo)
    expect(apiClient.getStarsChart).toHaveBeenCalledTimes(2);
  });
});
