import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useDashboard } from "../useDashboard";
import * as apiClient from "../../api/client";
import { createTestQueryClient } from "../../lib/react-query";
import { computeMovers } from "../../utils/movers";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getRepos: vi.fn(),
    listTriggeredAlerts: vi.fn(),
    listEarlySignals: vi.fn(),
    getSignalSummary: vi.fn(),
    acknowledgeSignal: vi.fn(),
    listAlertRules: vi.fn(),
    getWeeklySummary: vi.fn(),
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

function makeAlertRule(overrides: Partial<apiClient.AlertRule> = {}): apiClient.AlertRule {
  return {
    id: 1,
    name: "Star spike rule",
    description: null,
    repo_id: null,
    repo_name: null,
    signal_type: "velocity",
    operator: ">" as apiClient.AlertOperator,
    threshold: 30,
    enabled: true,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRelease(overrides: Partial<apiClient.WeeklyRelease> = {}): apiClient.WeeklyRelease {
  return {
    repo_id: 1,
    repo_name: "facebook/react",
    title: "v19.0.0",
    url: "https://github.com/facebook/react/releases/tag/v19.0.0",
    tags: [],
    published_at: "2024-01-20T00:00:00Z",
    ...overrides,
  };
}

function makeWeeklySummary(
  releases: apiClient.WeeklyRelease[] = [],
  overrides: Partial<apiClient.WeeklySummaryResponse> = {}
): apiClient.WeeklySummaryResponse {
  return {
    period_start: "2024-01-14",
    period_end: "2024-01-21",
    total_repos: 1,
    total_new_stars: 0,
    repos_compared: 1,
    top_gainers: [],
    top_losers: [],
    alerts_triggered: 0,
    early_signals_detected: 0,
    early_signals_by_type: {},
    hn_mentions: [],
    releases,
    // 預設「抓過了」：大部分測試在意的是 weekly 摘要本身的內容，不是
    // releasesChecked 這個旗標——那個旗標有自己專屬的測試（見下方
    // releasesChecked 那組），在這裡把它釘死可以避免所有其他測試意外
    // 依賴一個沒人特別設定的預設值。
    releases_ever_fetched: true,
    accelerating: 0,
    decelerating: 0,
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
  // 預設沒有規則、這週沒有版本：段一在沒有測試特別覆寫時應該是空的
  vi.mocked(apiClient.listAlertRules).mockResolvedValue([]);
  vi.mocked(apiClient.getWeeklySummary).mockResolvedValue(makeWeeklySummary([]));
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

  it("loads all APIs in parallel and sets data", async () => {
    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(apiClient.getRepos).toHaveBeenCalled();
    expect(apiClient.listTriggeredAlerts).toHaveBeenCalledWith(false, 50);
    expect(apiClient.listEarlySignals).toHaveBeenCalledWith({ limit: 20 });
    expect(apiClient.getSignalSummary).toHaveBeenCalled();
    expect(apiClient.listAlertRules).toHaveBeenCalled();
    expect(apiClient.getWeeklySummary).toHaveBeenCalled();

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
    // rules() 掛在 alerts.all 底下、weeklySummary() 掛在 dashboard.all 底下——
    // 兩者都該被既有的 invalidate 呼叫覆蓋到，不需要另外加一行 invalidateQueries
    expect(apiClient.listAlertRules).toHaveBeenCalled();
    expect(apiClient.getWeeklySummary).toHaveBeenCalled();
  });

  describe("useDashboard 供應段一與段二", () => {
    it("回傳 movers：把 repos 原封不動交給 computeMovers", async () => {
      // 不手動重算 computeMovers 的演算法（門檻、排序……那是 movers.test.ts 的事），
      // 只驗證 hook 有沒有把同一份 repos 轉交給它——直接拿真正的 computeMovers
      // 對同一份資料算一次期望值，這樣錯的接法（漏傳、傳錯來源、傳空陣列）都會產生
      // 不同的物件而露餡，不用在這裡複製一份門檻公式。
      const repos = [
        makeRepo({ id: 1, stars: 1100, stars_delta_1d: 100, stars_delta_7d: null }),
        makeRepo({
          id: 2,
          full_name: "vuejs/vue",
          stars: 500,
          stars_delta_1d: -50,
          stars_delta_7d: null,
        }),
      ];
      vi.mocked(apiClient.getRepos).mockResolvedValue({ repos, total: repos.length });

      const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.movers).toEqual(computeMovers(repos));
      // 順帶釘住這份 fixture 真的走到了「有資料」的分支，不是兩邊都回傳同一個空殼
      expect(result.current.movers.window).toBe(1);
      expect(result.current.movers.risers).toHaveLength(1);
    });

    it("deprecation 單獨出現不會被收進 attentionItems", async () => {
      // deprecation 是預告不是行動。alerts 來源另外歸零，避免預設的未確認警報
      // 混進來，讓這個測試意外因為「別的來源」而不是「這裡的過濾」通過。
      vi.mocked(apiClient.getRepos).mockResolvedValue({ repos: [makeRepo()], total: 1 });
      vi.mocked(apiClient.listTriggeredAlerts).mockResolvedValue([]);
      vi.mocked(apiClient.getWeeklySummary).mockResolvedValue(
        makeWeeklySummary([makeRelease({ tags: ["deprecation"] })])
      );

      const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.attentionItems).toEqual([]);
    });

    it("attentionItems 收未確認的警報與帶 breaking/security 的版本，同時排除已確認的警報與只有 deprecation 的版本", async () => {
      // 同一個測試裡同時放「該進來」跟「不該進來」的資料：只驗證結果是空的
      // 沒辦法分辨「過濾條件對」還是「過濾條件整個燒掉、什麼都不會進來」，
      // 也沒辦法分辨 alerts 那半的 acknowledged 過濾到底有沒有真的在跑。
      vi.mocked(apiClient.getRepos).mockResolvedValue({ repos: [makeRepo()], total: 1 });
      vi.mocked(apiClient.listTriggeredAlerts).mockResolvedValue([
        makeAlert({
          id: 1,
          rule_name: "Star spike",
          repo_name: "facebook/react",
          acknowledged: false,
        }),
        makeAlert({ id: 2, rule_name: "Old alert", repo_name: "vuejs/vue", acknowledged: true }),
      ]);
      vi.mocked(apiClient.getWeeklySummary).mockResolvedValue(
        makeWeeklySummary([
          makeRelease({ repo_name: "a/a", title: "v1.0.0", tags: ["deprecation"] }),
          makeRelease({
            repo_name: "b/b",
            title: "v2.0.0",
            tags: ["breaking"],
            url: "https://x/b",
          }),
          makeRelease({ repo_name: "c/c", title: "v3.0.0", tags: ["security", "deprecation"] }),
        ])
      );

      const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const items = result.current.attentionItems;
      expect(items).toHaveLength(3);

      const titles = items.map((i) => i.title);
      expect(titles).toContain("Star spike"); // 未確認警報：該收
      expect(titles).not.toContain("Old alert"); // 已確認警報：該排除
      expect(titles).toContain("b/b v2.0.0"); // breaking：該收
      expect(titles).toContain("c/c v3.0.0"); // security（即使同時帶 deprecation）：該收
      expect(titles).not.toContain("a/a v1.0.0"); // 只有 deprecation：該排除

      // 順便釘住兩種 kind 的形狀，不只是標題字串對得上——包含 id：它是 React key
      // 唯一性的依據，不能只驗字串內容對了就算數。
      expect(items).toContainEqual({
        id: "alert-1",
        kind: "alert",
        title: "Star spike",
        detail: "facebook/react",
      });
      expect(items).toContainEqual({
        id: "release-1-v2.0.0",
        kind: "release",
        title: "b/b v2.0.0",
        detail: "breaking",
        url: "https://x/b",
      });
    });

    it("同一條全域規則觸發多個 repo 時，attentionItems 給每一筆不同的 id", async () => {
      // 全域規則（repo_id=null）對每個觸發的 repo 各寫一筆 TriggeredAlert，
      // rule_name 因此完全相同。舊的 key（kind-title）只看得到 rule_name，
      // 同一條規則觸發多個 repo 就會產生重複的 key，React 用 key 對位重用 DOM，
      // re-render 後某一列可能繼續顯示上一輪別的 repo。這裡同時涵蓋兩個軸：
      // 同規則不同 repo（101/102）、同 repo 不同規則（103），確保 id 不是
      // 只靠其中一邊撐起唯一性。
      vi.mocked(apiClient.listTriggeredAlerts).mockResolvedValue([
        makeAlert({
          id: 101,
          rule_name: "Star spike",
          repo_name: "facebook/react",
          acknowledged: false,
        }),
        makeAlert({
          id: 102,
          rule_name: "Star spike",
          repo_name: "vuejs/vue",
          acknowledged: false,
        }),
        makeAlert({
          id: 103,
          rule_name: "Fork spike",
          repo_name: "facebook/react",
          acknowledged: false,
        }),
      ]);

      const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const ids = result.current.attentionItems.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(["alert-101", "alert-102", "alert-103"]);
    });

    it("hasAlertRules 反映是否真的有規則，而不是猜規則有沒有觸發過", async () => {
      vi.mocked(apiClient.listAlertRules).mockResolvedValue([]);
      const none = renderHook(() => useDashboard(), { wrapper: createWrapper() });
      await waitFor(() => {
        expect(none.result.current.isLoading).toBe(false);
      });
      expect(none.result.current.hasAlertRules).toBe(false);

      vi.mocked(apiClient.listAlertRules).mockResolvedValue([makeAlertRule()]);
      const some = renderHook(() => useDashboard(), { wrapper: createWrapper() });
      await waitFor(() => {
        expect(some.result.current.isLoading).toBe(false);
      });
      expect(some.result.current.hasAlertRules).toBe(true);
    });

    it("isLoading 會等 alertRulesQuery 一起完成才放行，不會提早在規則資料到之前開門", async () => {
      // hasAlertRules 沒有自己專屬的「已檢查」旗標（不像 weekly 有 releasesChecked），
      // 所以它的真實性完全靠 isLoading 確實等到規則資料回來才放行頁面。
      // 用手動控制的 promise 卡住 listAlertRules，其餘 4 個 query 照常秒 resolve——
      // 這樣才能製造出「只剩規則還沒回來」的時刻，而不是靠 mock 秒解的巧合時序。
      let resolveRules: (rules: apiClient.AlertRule[]) => void = () => {};
      vi.mocked(apiClient.listAlertRules).mockReturnValue(
        new Promise((resolve) => {
          resolveRules = resolve;
        })
      );

      const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

      // 等其餘 4 個 query 都確實解完（各自對應一個能觀察到的欄位），
      // 此時如果 isLoading 沒有把 alertRulesQuery 併進去，就會提早變成 false。
      await waitFor(() => {
        expect(result.current.stats.totalRepos).toBe(1);
        expect(result.current.stats.activeAlerts).toBe(1);
        expect(result.current.earlySignals).toHaveLength(1);
        expect(result.current.signalSummary).not.toBeNull();
      });
      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveRules([]);
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      expect(result.current.hasAlertRules).toBe(false);
    });

    it("alertRulesQuery 失敗時也會併入整體 error，跟其餘 4 個 query 走同一條聚合邏輯", async () => {
      vi.mocked(apiClient.listAlertRules).mockRejectedValue(new Error("rules down"));

      const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe("rules down");
    });

    it("releasesChecked 在 weekly 摘要載入完成後為 true", async () => {
      const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });
      await waitFor(() => {
        expect(result.current.releasesChecked).toBe(true);
      });
    });

    it("releasesChecked 在版本從未抓取過時維持 false，即使 weekly 摘要已經載入", async () => {
      // 這是這個旗標存在的唯一理由：只看「摘要載完了沒」分不出「查過、這週
      // 沒有版本」跟「抓取器根本沒跑過」——releases: [] 在兩種情況下長得
      // 一模一樣。weekly 在這裡是成功 resolve 的（不是 undefined），
      // releases_ever_fetched 才是真正該看的訊號。
      vi.mocked(apiClient.getWeeklySummary).mockResolvedValue(
        makeWeeklySummary([], { releases_ever_fetched: false })
      );

      const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.releasesChecked).toBe(false);
    });

    it("releasesChecked 在 weekly 摘要取得失敗時維持 false，且不會污染整體 error", async () => {
      // weekly 特意被排除在整體 isLoading／error 之外（見 useDashboard.ts 的註解），
      // releasesChecked 才是它專屬的溝通管道；這裡同時釘住兩件事，避免有人
      // 之後把 weeklyQuery 併回聚合邏輯，讓一次 sidecar 版本查詢失敗
      // 意外讓整頁跳進錯誤畫面。
      vi.mocked(apiClient.getWeeklySummary).mockRejectedValue(new Error("weekly summary down"));

      const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.releasesChecked).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });
});
