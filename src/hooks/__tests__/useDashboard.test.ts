import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useDashboard } from "../useDashboard";
import * as apiClient from "../../api/client";
import { createTestQueryClient } from "../../lib/react-query";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getRepos: vi.fn(),
    listTriggeredAlerts: vi.fn(),
    listEarlySignals: vi.fn(),
    getSignalSummary: vi.fn(),
    acknowledgeSignal: vi.fn(),
  };
});

function makeRepo(overrides: Partial<apiClient.RepoWithSignals> = {}): apiClient.RepoWithSignals {
  return {
    id: 1,
    owner: "facebook",
    name: "react",
    full_name: "facebook/react",
    url: "https://github.com/facebook/react",
    description: "A JavaScript library",
    language: "JavaScript",
    added_at: "2024-01-15T00:00:00Z",
    updated_at: "2024-01-15T00:00:00Z",
    stars: 200000,
    forks: 40000,
    stars_delta_7d: 100,
    stars_delta_30d: 400,
    velocity: 14.3,
    acceleration: 0.5,
    trend: 1,
    last_fetched: "2024-01-15T00:00:00Z",
    ...overrides,
  };
}

function makeAlert(overrides: Partial<apiClient.TriggeredAlert> = {}): apiClient.TriggeredAlert {
  return {
    id: 1,
    rule_id: 1,
    rule_name: "Star spike",
    repo_id: 1,
    repo_name: "facebook/react",
    signal_type: "velocity",
    signal_value: 50,
    threshold: 30,
    operator: ">" as apiClient.AlertOperator,
    triggered_at: "2024-01-20T00:00:00Z",
    acknowledged: false,
    acknowledged_at: null,
    ...overrides,
  };
}

function makeSignal(overrides: Partial<apiClient.EarlySignal> = {}): apiClient.EarlySignal {
  return {
    id: 1,
    repo_id: 1,
    repo_name: "facebook/react",
    signal_type: "sudden_spike" as apiClient.EarlySignalType,
    severity: "medium" as apiClient.EarlySignalSeverity,
    description: "Velocity spike detected",
    velocity_value: 50,
    star_count: 200000,
    percentile_rank: 95,
    detected_at: "2024-01-20T00:00:00Z",
    expires_at: null,
    acknowledged: false,
    acknowledged_at: null,
    ...overrides,
  };
}

const defaultSummary: apiClient.SignalSummary = {
  total_active: 2,
  by_type: { sudden_spike: 1, rising_star: 1 },
  by_severity: { medium: 1, high: 1 },
  repos_with_signals: 1,
};

function setupDefaultMocks() {
  vi.mocked(apiClient.getRepos).mockResolvedValue({
    repos: [makeRepo()],
    total: 1,
  });
  vi.mocked(apiClient.listTriggeredAlerts).mockResolvedValue([makeAlert()]);
  vi.mocked(apiClient.listEarlySignals).mockResolvedValue({
    signals: [makeSignal()],
    total: 1,
  });
  vi.mocked(apiClient.getSignalSummary).mockResolvedValue(defaultSummary);
}

function createWrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe("useDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("starts in loading state", () => {
    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it("loads all 4 APIs in parallel and sets data", async () => {
    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(apiClient.getRepos).toHaveBeenCalled();
    expect(apiClient.listTriggeredAlerts).toHaveBeenCalledWith(false, 50);
    expect(apiClient.listEarlySignals).toHaveBeenCalledWith({ limit: 5 });
    expect(apiClient.getSignalSummary).toHaveBeenCalled();

    expect(result.current.error).toBeNull();
    expect(result.current.earlySignals).toHaveLength(1);
    expect(result.current.signalSummary).toEqual(defaultSummary);
  });

  it("sets error when API fails", async () => {
    vi.mocked(apiClient.getRepos).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Network error");
  });

  it("computes stats correctly", async () => {
    const repos = [
      makeRepo({ id: 1, stars: 100000, stars_delta_7d: 50 }),
      makeRepo({ id: 2, stars: 200000, stars_delta_7d: 150, full_name: "vuejs/vue" }),
    ];
    vi.mocked(apiClient.getRepos).mockResolvedValue({ repos, total: 2 });
    vi.mocked(apiClient.listTriggeredAlerts).mockResolvedValue([
      makeAlert({ id: 1, acknowledged: false }),
      makeAlert({ id: 2, acknowledged: true }),
    ]);

    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.stats.totalRepos).toBe(2);
    expect(result.current.stats.totalStars).toBe(300000);
    expect(result.current.stats.weeklyStars).toBe(200);
    expect(result.current.stats.activeAlerts).toBe(1);
  });

  it("handles null values in stats computation", async () => {
    vi.mocked(apiClient.getRepos).mockResolvedValue({
      repos: [makeRepo({ stars: null, stars_delta_7d: null })],
      total: 1,
    });

    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.stats.totalStars).toBe(0);
    expect(result.current.stats.weeklyStars).toBe(0);
  });

  it("produces recentActivity sorted by timestamp and limited to 10", async () => {
    const repos = Array.from({ length: 8 }, (_, i) =>
      makeRepo({
        id: i + 1,
        full_name: `owner/repo-${i}`,
        added_at: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      })
    );
    const alerts = Array.from({ length: 5 }, (_, i) =>
      makeAlert({
        id: i + 1,
        rule_name: `Alert ${i}`,
        triggered_at: `2024-01-${String(i + 10).padStart(2, "0")}T00:00:00Z`,
      })
    );
    vi.mocked(apiClient.getRepos).mockResolvedValue({ repos, total: 8 });
    vi.mocked(apiClient.listTriggeredAlerts).mockResolvedValue(alerts);

    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.recentActivity).toHaveLength(10);
    const timestamps = result.current.recentActivity.map((a) => a.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(new Date(timestamps[i - 1]).getTime()).toBeGreaterThanOrEqual(
        new Date(timestamps[i]).getTime()
      );
    }
  });

  it("computes velocityDistribution buckets correctly", async () => {
    const repos = [
      makeRepo({ id: 1, velocity: -5 }),
      makeRepo({ id: 2, velocity: 0 }),
      makeRepo({ id: 3, velocity: 5 }),
      makeRepo({ id: 4, velocity: 25 }),
      makeRepo({ id: 5, velocity: 75 }),
      makeRepo({ id: 6, velocity: 150 }),
      makeRepo({ id: 7, velocity: null }),
    ];
    vi.mocked(apiClient.getRepos).mockResolvedValue({ repos, total: 7 });

    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const dist = result.current.velocityDistribution;
    expect(dist).toHaveLength(5);
    expect(dist[0]).toEqual({ key: "negative", count: 1 });
    expect(dist[1]).toEqual({ key: "low", count: 3 });
    expect(dist[2]).toEqual({ key: "medium", count: 1 });
    expect(dist[3]).toEqual({ key: "high", count: 1 });
    expect(dist[4]).toEqual({ key: "veryHigh", count: 1 });
  });

  it("acknowledgeSignal calls API and invalidates cache", async () => {
    vi.mocked(apiClient.acknowledgeSignal).mockResolvedValue({
      status: "ok",
      message: "acknowledged",
    });

    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.earlySignals).toHaveLength(1);

    await act(async () => {
      await result.current.acknowledgeSignal(1);
    });

    expect(apiClient.acknowledgeSignal).toHaveBeenCalledWith(1);
  });

  it("acknowledgeSignal silently handles errors", async () => {
    vi.mocked(apiClient.acknowledgeSignal).mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.acknowledgeSignal(1);
    });

    // Should not throw — signals remain since invalidation refetch uses same mock
    expect(result.current.earlySignals).toHaveLength(1);
  });

  it("refresh invalidates all queries", async () => {
    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    vi.clearAllMocks();
    setupDefaultMocks();

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(apiClient.getRepos).toHaveBeenCalled();
    });

    expect(apiClient.listTriggeredAlerts).toHaveBeenCalled();
    expect(apiClient.listEarlySignals).toHaveBeenCalled();
    expect(apiClient.getSignalSummary).toHaveBeenCalled();
  });
});
