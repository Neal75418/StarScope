import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useStarsChart } from "../useStarsChart";
import * as apiClient from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getStarsChart: vi.fn(),
    getStarHistory: vi.fn(),
  };
});

describe("useStarsChart", () => {
  const mockChartData: apiClient.ChartDataPoint[] = [
    { date: "2024-01-01", stars: 100, forks: 10 },
    { date: "2024-01-08", stars: 150, forks: 15 },
  ];

  const mockStarHistory: apiClient.StarHistoryPoint[] = [
    { date: "2024-01-01", stars: 100 },
    { date: "2024-01-15", stars: 200 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getStarsChart).mockReset();
    vi.mocked(apiClient.getStarHistory).mockReset();
  });

  it("returns initial loading state", () => {
    vi.mocked(apiClient.getStarsChart).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useStarsChart(1));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBe(null);
    expect(result.current.timeRange).toBe("30d");
  });

  it("loads chart data with default 30d time range", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue({
      repo_id: 1,
      repo_name: "test/repo",
      time_range: "30d",
      data_points: mockChartData,
      min_stars: 100,
      max_stars: 150,
    });

    const { result } = renderHook(() => useStarsChart(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockChartData);
    expect(result.current.error).toBe(null);
    expect(apiClient.getStarsChart).toHaveBeenCalledWith(1, "30d");
  });

  it("handles API error", async () => {
    vi.mocked(apiClient.getStarsChart).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useStarsChart(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Network error");
    expect(result.current.data).toEqual([]);
  });

  it("changes time range", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue({
      repo_id: 1,
      repo_name: "test/repo",
      time_range: "7d",
      data_points: mockChartData,
      min_stars: 100,
      max_stars: 150,
    });

    const { result } = renderHook(() => useStarsChart(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setTimeRange("7d");
    });

    await waitFor(() => {
      expect(apiClient.getStarsChart).toHaveBeenCalledWith(1, "7d");
    });
  });

  it("uses getStarHistory for 'all' time range", async () => {
    vi.mocked(apiClient.getStarHistory).mockResolvedValue({
      repo_id: 1,
      repo_name: "test/repo",
      history: mockStarHistory,
      is_backfilled: false,
      total_points: 2,
    });

    const { result } = renderHook(() => useStarsChart(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setTimeRange("all");
    });

    await waitFor(() => {
      expect(apiClient.getStarHistory).toHaveBeenCalledWith(1);
    });
  });

  it("refetches data when refetch is called", async () => {
    vi.mocked(apiClient.getStarsChart).mockResolvedValue({
      repo_id: 1,
      repo_name: "test/repo",
      time_range: "30d",
      data_points: mockChartData,
      min_stars: 100,
      max_stars: 150,
    });

    const { result } = renderHook(() => useStarsChart(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const initialCallCount = vi.mocked(apiClient.getStarsChart).mock.calls.length;

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(vi.mocked(apiClient.getStarsChart).mock.calls.length).toBeGreaterThan(
        initialCallCount
      );
    });
  });
});
