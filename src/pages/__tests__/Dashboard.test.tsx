import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "../Dashboard";
import type { DashboardStats, RecentActivity } from "../../hooks/useDashboard";
import type { EarlySignal, SignalSummary } from "../../api/client";
import type { MoversResult } from "../../utils/movers";
import type { AttentionItem } from "../../components/dashboard/AttentionBar";
import {
  saveWidgetVisibility,
  type WidgetVisibility,
} from "../../components/dashboard/WidgetCustomizer";
import { createTestQueryClient } from "../../lib/react-query";

const mockRefresh = vi.fn();
const mockNavigateTo = vi.fn();

vi.mock("../../contexts/NavigationContext", () => ({
  useNavigation: () => ({
    navigateTo: mockNavigateTo,
    navigationState: null,
    consumeNavigationState: () => null,
  }),
}));
const mockAcknowledgeSignal = vi.fn();

function makeSignal(overrides: Partial<EarlySignal> = {}): EarlySignal {
  return {
    id: 1,
    repo_id: 1,
    repo_name: "facebook/react",
    signal_type: "rising_star",
    severity: "high",
    description: "Stars rising fast",
    velocity_value: 100,
    star_count: 200000,
    percentile_rank: 99,
    detected_at: new Date().toISOString(),
    expires_at: null,
    acknowledged: false,
    acknowledged_at: null,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<SignalSummary> = {}): SignalSummary {
  return {
    total_active: 3,
    by_type: { rising_star: 2, sudden_spike: 1 },
    by_severity: { high: 1, medium: 1, low: 1 },
    repos_with_signals: 2,
    ...overrides,
  };
}

function makeActivity(overrides: Partial<RecentActivity> = {}): RecentActivity {
  return {
    id: "a-1",
    type: "repo_added",
    title: "Added react",
    description: "New repo tracked",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

let mockDashboard: {
  stats: DashboardStats;
  recentActivity: RecentActivity[];
  velocityDistribution: { key: string; count: number }[];
  languageDistribution: { language: string; count: number }[];
  earlySignals: EarlySignal[];
  signalSummary: SignalSummary | null;
  movers: MoversResult;
  attentionItems: AttentionItem[];
  hasAlertRules: boolean;
  releasesChecked: boolean;
  acknowledgeSignal: (id: number) => void;
  isLoading: boolean;
  dataUpdatedAt: number;
  error: string | null;
  refresh: () => void;
};

vi.mock("../../hooks/useDashboard", () => ({
  useDashboard: () => mockDashboard,
}));

vi.mock("../../contexts/AppStatusContext", () => ({
  useAppStatus: () => ({
    isOnline: true,
    level: "online",
    showBanner: false,
    bannerMessage: null,
    isSidecarUp: true,
  }),
}));

// noinspection JSUnusedGlobalSymbols
vi.mock("../../components/motion", () => ({
  AnimatedPage: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  FadeIn: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../components/Skeleton", () => ({
  Skeleton: () => <span data-testid="skeleton" />,
}));

// 段三維持 stub：WeeklySummary 內部的 useWeeklySummary 會打真的 react-query，
// 組裝測試不需要真的版本清單內容，只需要一個穩定的位置標記代表「段三在哪裡」。
// weekly-releases 這個 testid 借用真實 ReleasesList 的名字，是段三在排序測試裡
// 的定位點；清單本身的渲染邏輯已經由 WeeklyReleases.test.tsx 等既有測試涵蓋。
vi.mock("../../components/dashboard/WeeklySummary", () => ({
  WeeklySummary: () => (
    <div data-testid="weekly-summary">
      <div data-testid="weekly-releases" />
    </div>
  ),
}));

vi.mock("../../components/dashboard/VelocityChartRecharts", () => ({
  VelocityChartRecharts: ({ data }: { data: { key: string; count: number }[] }) => (
    <div data-testid="velocity-chart">
      {data.map((d) => (
        <span key={d.key} data-testid={`velocity-${d.key}`}>
          {d.key}:{d.count}
        </span>
      ))}
    </div>
  ),
}));

vi.mock("../../components/dashboard/PortfolioHistory", () => ({
  PortfolioHistory: () => <div data-testid="portfolio-history" />,
}));

vi.mock("../../components/dashboard/LanguageDistribution", () => ({
  LanguageDistribution: () => <div data-testid="language-distribution" />,
}));

vi.mock("../../components/dashboard/CategorySummary", () => ({
  CategorySummary: () => <div data-testid="category-summary" />,
}));

// AttentionBar 與 MoversPanel 刻意不 mock，跟既有的 SignalSpotlight 待遇一致——
// 組裝測試要驗證的正是這兩個元件真的被放進頁面、真的吃到對的 props，
// mock 掉反而測不出「有沒有接上」這件事。

// 段一與段二現在會渲染真的內容，movers/attentionItems 不能再缺席：
// 缺席時 MoversPanel 會對 undefined 取 .window，直接讓整個測試檔炸掉
const EMPTY_MOVERS: MoversResult = {
  window: null,
  risers: [],
  fallers: [],
  threshold: null,
  totalDelta: null,
};

// 重設計把大部分 widget 的預設值改成關閉（見 WidgetCustomizer 的 DEFAULT_VISIBILITY），
// 但下面這些既有測試是在「使用者已經打開全部 widget」的前提下寫的——那正是重設計前
// 唯一存在過的狀態，不是憑空捏造的情境。用 localStorage 把這個前提補回來，
// 讓這些測試繼續驗證各 widget 自己的渲染邏輯，不必逐條測試加開關。
// 真正的「預設狀態長怎樣」由下面的「三段排列」describe 另外驗證。
const ALL_WIDGETS_VISIBLE: WidgetVisibility = {
  statsGrid: true,
  signalSpotlight: true,
  weeklySummary: true,
  portfolioHistory: true,
  velocityChart: true,
  languageDistribution: true,
  categorySummary: true,
  recentActivity: true,
};

function createWrapper() {
  const client = createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    saveWidgetVisibility(ALL_WIDGETS_VISIBLE);
    mockDashboard = {
      stats: { totalRepos: 10, totalStars: 50000, weeklyStars: 1200, activeAlerts: 2 },
      recentActivity: [],
      velocityDistribution: [
        { key: "low", count: 3 },
        { key: "medium", count: 5 },
      ],
      languageDistribution: [],
      earlySignals: [],
      signalSummary: null,
      movers: EMPTY_MOVERS,
      attentionItems: [],
      hasAlertRules: true,
      releasesChecked: true,
      acknowledgeSignal: mockAcknowledgeSignal,
      isLoading: false,
      // 固定在遙遠的過去：formatCompactRelativeTime 對它的輸出（locale 日期字串）
      // 不會跟任何一條既有測試斷言的相對時間文字（"Just now"／"2h"／"3d"……）撞在一起
      dataUpdatedAt: new Date("2024-01-20T12:00:00Z").getTime(),
      error: null,
      refresh: mockRefresh,
    };
  });

  it("collapses to an onboarding card with a Discover CTA when nothing is tracked", async () => {
    const user = userEvent.setup();
    mockDashboard.stats = { totalRepos: 0, totalStars: 0, weeklyStars: 0, activeAlerts: 0 };
    render(<Dashboard />);
    expect(screen.getByTestId("dashboard-onboard")).toBeInTheDocument();
    // 六個空模組一個都不該渲染
    expect(screen.queryByTestId("weekly-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("portfolio-history")).not.toBeInTheDocument();
    expect(screen.queryByTestId("portfolio-health-score")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("dashboard-onboard-cta"));
    expect(mockNavigateTo).toHaveBeenCalledWith("discovery");
  });

  it("applies the danger accent only when alerts are active (red must mean something)", () => {
    mockDashboard.stats.activeAlerts = 0;
    render(<Dashboard />);
    const card = screen.getByText("Active Alerts").closest(".stat-card");
    expect(card).not.toHaveClass("stat-card--danger");
  });

  it("applies the danger accent when alerts exist", () => {
    mockDashboard.stats.activeAlerts = 3;
    render(<Dashboard />);
    const card = screen.getByText("Active Alerts").closest(".stat-card");
    expect(card).toHaveClass("stat-card--danger");
  });

  it("shows loading skeletons when loading", () => {
    mockDashboard.isLoading = true;
    render(<Dashboard />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThanOrEqual(4);
  });

  it("shows error state with retry button", async () => {
    const user = userEvent.setup();
    mockDashboard.error = "Network error";
    render(<Dashboard />);
    expect(screen.getByText("Network error")).toBeInTheDocument();
    await user.click(screen.getByText("Retry"));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("clicking AttentionBar's refresh button calls the hook's refresh — DataFreshnessBar is gone, this is the page's only manual refresh entry point now", async () => {
    // AttentionBar 是真的元件（不 mock），跟下面 acknowledge 那條測試對 SignalSpotlight
    // 的待遇一致：onAcknowledge 有端對端點擊測試釘住，onRefresh 之前沒有，
    // 錯接一個什麼都不做的函式會 tsc 通過、沒有任何測試發現——按鈕還在、還能點，
    // 只是點了沒反應，畫面上也不會有任何提示。
    const user = userEvent.setup();
    render(<Dashboard />);
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders stats grid", () => {
    render(<Dashboard />);
    expect(screen.getByText("Tracked Repos")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Total Stars")).toBeInTheDocument();
    expect(screen.getByText("50.0K")).toBeInTheDocument();
  });

  it("renders velocity distribution chart", () => {
    render(<Dashboard />);
    expect(screen.getByTestId("velocity-chart")).toBeInTheDocument();
    expect(screen.getByTestId("velocity-low")).toBeInTheDocument();
    expect(screen.getByTestId("velocity-medium")).toBeInTheDocument();
  });

  it("renders recent activity section", () => {
    mockDashboard.recentActivity = [makeActivity()];
    render(<Dashboard />);
    expect(screen.getByText("Recent Activity")).toBeInTheDocument();
    expect(screen.getByText("Added react")).toBeInTheDocument();
  });

  it("formats weekly stars with plus sign for positive delta", () => {
    mockDashboard.stats.weeklyStars = 1200;
    render(<Dashboard />);
    expect(screen.getByText("+1.2K")).toBeInTheDocument();
  });

  it("formats zero weekly stars without a sign (zero has no direction)", () => {
    mockDashboard.stats.weeklyStars = 0;
    render(<Dashboard />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("+0")).not.toBeInTheDocument();
  });

  it("formats large numbers with M suffix", () => {
    mockDashboard.stats.totalStars = 1500000;
    render(<Dashboard />);
    expect(screen.getByText("1.5M")).toBeInTheDocument();
  });

  it("formats small numbers without suffix", () => {
    mockDashboard.stats.totalStars = 500;
    render(<Dashboard />);
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("shows empty activity state when no recent activity", () => {
    mockDashboard.recentActivity = [];
    render(<Dashboard />);
    expect(screen.getByText("No recent activity")).toBeInTheDocument();
  });

  it("renders activity with alert_triggered type", () => {
    mockDashboard.recentActivity = [
      makeActivity({ id: "a-2", type: "alert_triggered", title: "Alert fired" }),
    ];
    render(<Dashboard />);
    expect(screen.getByText("Alert fired")).toBeInTheDocument();
    expect(screen.getByText("!")).toBeInTheDocument();
  });

  it("renders activity with description", () => {
    mockDashboard.recentActivity = [
      makeActivity({ title: "Added repo", description: "Some description" }),
    ];
    render(<Dashboard />);
    expect(screen.getByText("Some description")).toBeInTheDocument();
  });

  it("renders signal spotlight when summary has active signals", async () => {
    const user = userEvent.setup();
    mockDashboard.signalSummary = makeSummary();
    mockDashboard.earlySignals = [makeSignal()];
    render(<Dashboard />);
    expect(screen.getByText("Signal Spotlight")).toBeInTheDocument();
    // "3" appears in both velocity chart and signal spotlight, use getAllByText
    expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Rising Star")).toBeInTheDocument();
    expect(screen.getByText("Stars rising fast")).toBeInTheDocument();
    expect(screen.getByText("facebook/react")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    await user.click(screen.getByTitle("Acknowledge"));
    expect(mockAcknowledgeSignal).toHaveBeenCalledWith(1);
  });

  it("does not render signal spotlight when summary is null", () => {
    mockDashboard.signalSummary = null;
    render(<Dashboard />);
    expect(screen.queryByText("Signal Spotlight")).not.toBeInTheDocument();
  });

  it("does not render signal spotlight when total_active is 0", () => {
    mockDashboard.signalSummary = makeSummary({ total_active: 0, by_type: {} });
    render(<Dashboard />);
    expect(screen.queryByText("Signal Spotlight")).not.toBeInTheDocument();
  });

  it("formats time as 'Just now' for recent activities", () => {
    mockDashboard.recentActivity = [makeActivity({ title: "Recent action" })];
    render(<Dashboard />);
    expect(screen.getByText("Just now")).toBeInTheDocument();
  });

  it("formats time as hours for activities within a day", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mockDashboard.recentActivity = [
      makeActivity({ title: "Two hours ago", timestamp: twoHoursAgo }),
    ];
    render(<Dashboard />);
    expect(screen.getByText("2h")).toBeInTheDocument();
  });

  it("formats time as days for activities within a week", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    mockDashboard.recentActivity = [
      makeActivity({ title: "Three days ago", timestamp: threeDaysAgo }),
    ];
    render(<Dashboard />);
    expect(screen.getByText("3d")).toBeInTheDocument();
  });

  it("formats time as date for activities older than a week", () => {
    const twoWeeksAgoDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = twoWeeksAgoDate.toISOString();
    mockDashboard.recentActivity = [makeActivity({ title: "Old action", timestamp: twoWeeksAgo })];
    render(<Dashboard />);
    expect(screen.getByText("Old action")).toBeInTheDocument();
    // For activities older than 7 days, formatCompactRelativeTime returns toLocaleDateString()
    // Both source and test use default locale — consistent within the same runtime
    const expectedDate = twoWeeksAgoDate.toLocaleDateString();
    expect(screen.getByText(expectedDate)).toBeInTheDocument();
  });

  it("renders signal with unknown type using fallback", () => {
    mockDashboard.signalSummary = makeSummary({
      total_active: 1,
      by_type: { unknown_type: 1 },
    });
    mockDashboard.earlySignals = [
      makeSignal({
        signal_type: "rising_star",
        repo_name: "test/repo",
        severity: "low",
        description: "Unknown signal",
      }),
    ];
    render(<Dashboard />);
    expect(screen.getByText("Unknown signal")).toBeInTheDocument();
    expect(screen.getByText("low")).toBeInTheDocument();
  });

  it("renders signal time formats in spotlight", () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    mockDashboard.signalSummary = makeSummary({
      total_active: 1,
      by_type: { rising_star: 1 },
    });
    mockDashboard.earlySignals = [
      makeSignal({
        repo_name: "test/repo",
        severity: "medium",
        description: "Signal",
        detected_at: fiveHoursAgo,
      }),
    ];
    render(<Dashboard />);
    expect(screen.getByText("5h")).toBeInTheDocument();
  });

  it("renders negative weekly stars without plus sign", () => {
    mockDashboard.stats.weeklyStars = -500;
    render(<Dashboard />);
    expect(screen.getByText("-500")).toBeInTheDocument();
  });

  describe("三段排列", () => {
    // 排序測的是「使用者第一次打開」這個預設狀態，不是被使用者調整過的畫面，
    // 所以要蓋掉外層 beforeEach 為了相容舊測試而塞回去的「全部打開」。
    beforeEach(() => {
      localStorage.clear();
    });

    it("段一在段二之前，段二在段三之前", () => {
      // 順序就是設計本身：依「漏看的代價」由高到低。
      // 原題目只查 order[0] 與 order[order.length-1]：只要頭尾對，中間即使
      // 整段消失（例如 MoversPanel 整個被刪掉）也測不出來，這裡改成比對
      // 完整序列，任何一段被拿掉、重排、或多插一段都會讓陣列對不上。
      render(<Dashboard />, { wrapper: createWrapper() });

      const titleEl = screen.getByTestId("page-title");
      const page = titleEl.closest(".dashboard-page");
      if (!page) throw new Error("找不到 .dashboard-page");

      const order = [...page.querySelectorAll("[data-testid]")]
        .map((el) => el.getAttribute("data-testid"))
        .filter(
          (id): id is string =>
            id !== null &&
            ["attention-bar", "movers-title", "movers-empty", "weekly-releases"].includes(id)
        );

      expect(order).toEqual(["attention-bar", "movers-empty", "weekly-releases"]);
    });

    it("SignalSpotlight 排在排行之前——持久層在上、即時層在下", () => {
      // 原本這條只斷言 movers-empty 存在，不管兩者誰先誰後都會通過（見 task-8-brief
      // 的已知缺陷記錄）。改成先讓 SignalSpotlight 真的有訊號可顯示，
      // 再比較它與 MoversPanel 在 DOM 中的相對位置。
      mockDashboard.signalSummary = makeSummary();
      mockDashboard.earlySignals = [makeSignal()];
      render(<Dashboard />, { wrapper: createWrapper() });

      const titleEl = screen.getByTestId("page-title");
      const page = titleEl.closest(".dashboard-page");
      if (!page) throw new Error("找不到 .dashboard-page");

      const order = [
        ...page.querySelectorAll(
          '.signal-spotlight, [data-testid="movers-title"], [data-testid="movers-empty"]'
        ),
      ].map((el) =>
        el.classList.contains("signal-spotlight")
          ? "signal-spotlight"
          : el.getAttribute("data-testid")
      );

      expect(order).toEqual(["signal-spotlight", "movers-empty"]);
    });
  });
});
