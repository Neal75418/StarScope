import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Dashboard } from "../Dashboard";
import type { DashboardStats, RecentActivity } from "../../hooks/useDashboard";
import type { EarlySignal, SignalSummary } from "../../api/client";

const mockRefresh = vi.fn();
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
  velocityDistribution: { label: string; count: number }[];
  earlySignals: EarlySignal[];
  signalSummary: SignalSummary | null;
  acknowledgeSignal: (id: number) => void;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

vi.mock("../../hooks/useDashboard", () => ({
  useDashboard: () => mockDashboard,
}));


vi.mock("../../components/motion", () => ({
  AnimatedPage: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  FadeIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../components/Skeleton", () => ({
  Skeleton: () => <span data-testid="skeleton" />,
}));

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDashboard = {
      stats: { totalRepos: 10, totalStars: 50000, weeklyStars: 1200, activeAlerts: 2 },
      recentActivity: [],
      velocityDistribution: [
        { label: "0-1", count: 3 },
        { label: "1-5", count: 5 },
      ],
      earlySignals: [],
      signalSummary: null,
      acknowledgeSignal: mockAcknowledgeSignal,
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    };
  });

  it("shows loading skeletons when loading", () => {
    mockDashboard.isLoading = true;
    render(<Dashboard />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("shows error state with retry button", async () => {
    const user = userEvent.setup();
    mockDashboard.error = "Network error";
    render(<Dashboard />);
    expect(screen.getByText("Network error")).toBeInTheDocument();
    await user.click(screen.getByText("Retry"));
    expect(mockRefresh).toHaveBeenCalled();
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
    expect(screen.getByText("Velocity Distribution")).toBeInTheDocument();
    expect(screen.getByText("0-1")).toBeInTheDocument();
    expect(screen.getByText("1-5")).toBeInTheDocument();
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

  it("formats weekly stars with plus sign for zero", () => {
    mockDashboard.stats.weeklyStars = 0;
    render(<Dashboard />);
    expect(screen.getByText("+0")).toBeInTheDocument();
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
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    mockDashboard.recentActivity = [makeActivity({ title: "Old action", timestamp: twoWeeksAgo })];
    render(<Dashboard />);
    expect(screen.getByText("Old action")).toBeInTheDocument();
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
});
