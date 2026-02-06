import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Dashboard } from "../Dashboard";
import type { DashboardStats, RecentActivity } from "../../hooks/useDashboard";
import type { EarlySignal, SignalSummary } from "../../api/client";

const mockRefresh = vi.fn();
const mockAcknowledgeSignal = vi.fn();

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

vi.mock("../../i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../i18n")>();
  return {
    ...actual,
    useI18n: () => ({
      t: {
        common: { error: "Error", retry: "Retry", loading: "Loading..." },
        dashboard: {
          title: "Dashboard",
          subtitle: "Overview of your repos",
          stats: {
            totalRepos: "Total Repos",
            totalStars: "Total Stars",
            weeklyStars: "Weekly Stars",
            activeAlerts: "Active Alerts",
          },
          velocityDistribution: "Velocity Distribution",
          recentActivity: "Recent Activity",
          activity: {
            justNow: "Just now",
            empty: "No recent activity",
          },
          signals: {
            title: "Early Signals",
            acknowledge: "Acknowledge",
            types: {
              risingStar: "Rising Star",
              suddenSpike: "Sudden Spike",
              breakout: "Breakout",
              viralHn: "Viral HN",
            },
          },
        },
      },
    }),
  };
});

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
    expect(screen.getByText("Total Repos")).toBeInTheDocument();
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
    mockDashboard.recentActivity = [
      {
        id: "a-1",
        type: "repo_added",
        title: "Added react",
        description: "New repo tracked",
        timestamp: new Date().toISOString(),
      },
    ];
    render(<Dashboard />);
    expect(screen.getByText("Recent Activity")).toBeInTheDocument();
    expect(screen.getByText("Added react")).toBeInTheDocument();
  });
});
