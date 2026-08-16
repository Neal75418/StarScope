import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
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
    stars_delta_1d: 20,
    stars_delta_7d: 100,
    stars_delta_30d: 400,
    velocity: 14.3,
    acceleration: 0.5,
    trend: 1,
    forks_delta_7d: null,
    forks_delta_30d: null,
    issues_delta_7d: null,
    issues_delta_30d: null,
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
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
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
    expect(apiClient.listEarlySignals).toHaveBeenCalledWith({ limit: 20 });
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
    vi.mocked(apiClient.getRepos).mockResolvedValue({
      repos,
      total: 2,
    });
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

  it("reports weeklyStars as null when no repo has a 7-day baseline", async () => {
    // 這條原本斷言 weeklyStars === 0，把 bug 寫成了規格：全新安裝的 app 沒有 7 天
    // 快照，畫面因此顯示「近 7 天星數 0」，讀起來像「這週一顆星都沒漲」。
    // stars 仍然是 0：那個 ?? 0 是對的，null 星數的 repo 就是沒有星數可加。
    vi.mocked(apiClient.getRepos).mockResolvedValue({
      repos: [makeRepo({ stars: null, stars_delta_7d: null })],
      total: 1,
    });

    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.stats.totalStars).toBe(0);
    expect(result.current.stats.weeklyStars).toBeNull();
  });

  it("sums only the repos that have a 7-day delta", async () => {
    // 部分有值時要加總有值的，不能因為有人是 null 就整個放棄
    vi.mocked(apiClient.getRepos).mockResolvedValue({
      repos: [
        makeRepo({ id: 1, stars_delta_7d: 30 }),
        makeRepo({ id: 2, stars_delta_7d: null }),
        makeRepo({ id: 3, stars_delta_7d: -5 }),
      ],
      total: 3,
    });

    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.stats.weeklyStars).toBe(25);
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
    vi.mocked(apiClient.getRepos).mockResolvedValue({
      repos,
      total: 8,
    });
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
    vi.mocked(apiClient.getRepos).mockResolvedValue({
      repos,
      total: 7,
    });

    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // 原本 low 是 3：velocity 為 null 的那個被 ?? 0 併進了 0-10 桶。
    // 剛裝好的 app 每個 repo 都是 null，整張圖會全部擠在最低那一格，
    // 看起來像「所有 repo 都幾乎不成長」，而實際上只是還沒得算。
    const dist = result.current.velocityDistribution;
    expect(dist).toHaveLength(6);
    expect(dist[0]).toEqual({ key: "negative", count: 1 });
    expect(dist[1]).toEqual({ key: "low", count: 2 });
    expect(dist[2]).toEqual({ key: "medium", count: 1 });
    expect(dist[3]).toEqual({ key: "high", count: 1 });
    expect(dist[4]).toEqual({ key: "veryHigh", count: 1 });
    expect(dist[5]).toEqual({ key: "unknown", count: 1 });
  });

  it("omits the unknown bucket when every repo has a velocity", async () => {
    // 穩定運轉時不該永遠掛一個空的「資料不足」欄位
    vi.mocked(apiClient.getRepos).mockResolvedValue({
      repos: [makeRepo({ id: 1, velocity: 5 }), makeRepo({ id: 2, velocity: 25 })],
      total: 2,
    });

    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.velocityDistribution).toHaveLength(5);
    expect(result.current.velocityDistribution.map((d) => d.key)).not.toContain("unknown");
  });

  describe("healthScoreInput", () => {
    // 這段原本沒有任何測試，而它就是實測中把「94 個 repo 全部還沒有歷史」
    // 算成「停滯中 94」並給出 75 分「良好」的地方。
    async function renderWith(repos: apiClient.RepoWithSignals[]) {
      vi.mocked(apiClient.getRepos).mockResolvedValue({ repos, total: repos.length });
      const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      return result;
    }

    it("gives no score at all when nothing can be measured yet", async () => {
      const result = await renderWith([
        makeRepo({ id: 1, velocity: null }),
        makeRepo({ id: 2, velocity: null }),
      ]);

      const input = result.current.healthScoreInput;
      expect(input.score).toBeNull();
      expect(input.staleRepos).toBe(0);
      expect(input.reposAwaitingHistory).toBe(2);
    });

    it("does not count a repo without history as stale", async () => {
      // 一個真的停滯、三個還沒得算。停滯比例是 1/1，不是 1/4，也不是 4/4。
      const result = await renderWith([
        makeRepo({ id: 1, velocity: 0 }),
        makeRepo({ id: 2, velocity: null }),
        makeRepo({ id: 3, velocity: null }),
        makeRepo({ id: 4, velocity: null }),
      ]);

      const input = result.current.healthScoreInput;
      expect(input.staleRepos).toBe(1);
      expect(input.reposAwaitingHistory).toBe(3);
      expect(input.totalRepos).toBe(4);
    });

    it("scores a genuinely stagnant portfolio the same as one that is merely new", async () => {
      // 相同的「全部不成長」在有資料與沒資料兩種情況下必須被區分：
      // 前者是可以下判斷的壞消息，後者只是還不知道。
      const measured = await renderWith([
        makeRepo({ id: 1, velocity: 0 }),
        makeRepo({ id: 2, velocity: 0 }),
      ]);
      const measuredScore = measured.current.healthScoreInput.score;

      const unmeasured = await renderWith([
        makeRepo({ id: 3, velocity: null }),
        makeRepo({ id: 4, velocity: null }),
      ]);

      expect(measuredScore).not.toBeNull();
      expect(unmeasured.current.healthScoreInput.score).toBeNull();
    });

    it("keeps the stale ratio on the measurable repos, not the whole watchlist", async () => {
      // 分母若用總數，歷史不足的 repo 會稀釋掉真實的停滯比例，
      // 讓一組全部停滯的 repo 因為旁邊有很多「還沒算」而顯得健康。
      const allStale = await renderWith([makeRepo({ id: 1, velocity: 0 })]);
      const diluted = await renderWith([
        makeRepo({ id: 1, velocity: 0 }),
        makeRepo({ id: 2, velocity: null }),
        makeRepo({ id: 3, velocity: null }),
      ]);

      expect(diluted.current.healthScoreInput.score).toBe(allStale.current.healthScoreInput.score);
    });
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
