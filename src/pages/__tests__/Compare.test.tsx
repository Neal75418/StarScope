import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Compare } from "../Compare";
import type { ReactNode } from "react";
import type { ComparisonRepoData, ChartDataPoint, RepoWithSignals } from "../../api/types";

// ==================== Mocks ====================

const mockRefetch = vi.fn();
let mockComparisonReturn: {
  data: { repos: ComparisonRepoData[]; time_range: string } | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

vi.mock("../../hooks/useComparison", () => ({
  useComparison: () => mockComparisonReturn,
}));

let mockRepos: RepoWithSignals[];

vi.mock("../../hooks/useReposQuery", () => ({
  useReposQuery: () => ({ data: mockRepos, isLoading: false, error: null }),
}));

vi.mock("../../hooks/useTrendEarlySignals", () => ({
  useTrendEarlySignals: () => ({
    signalsByRepoId: {},
    loading: false,
    reposWithBreakouts: new Set<number>(),
  }),
}));

let mockNavigationState: Record<string, unknown> | null = null;
const mockConsumeNavigationState = vi.fn(() => {
  const state = mockNavigationState;
  mockNavigationState = null;
  return state;
});
vi.mock("../../contexts/NavigationContext", () => ({
  useNavigation: () => ({
    navigateTo: vi.fn(),
    navigationState: mockNavigationState,
    consumeNavigationState: mockConsumeNavigationState,
  }),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: {
      compare: {
        title: "Compare",
        subtitle: "Compare star trends across repositories",
        selectRepos: "Select repositories to compare",
        searchPlaceholder: "Search watchlist...",
        minRepos: "Select at least 2 repos",
        maxRepos: "Maximum 5 repos",
        normalize: "Normalize (%)",
        logScale: "Log Scale",
        growthRate: "Growth Rate",
        share: "Share",
        shareCopied: "Copied!",
        metrics: "Metrics",
        noData: "No data available for selected time range",
        retry: "Retry",
        download: "Download PNG",
        timeRangeLabels: {
          "7d": "7 days",
          "30d": "30 days",
          "90d": "90 days",
          all: "All time",
        },
        metric: {
          stars: "Stars",
          forks: "Forks",
          issues: "Issues",
        },
        chartType: {
          line: "Line",
          area: "Area",
        },
        export: {
          button: "Export",
          json: "Download JSON",
          csv: "Download CSV",
        },
        columns: {
          repo: "Repository",
          stars: "Stars",
          delta7d: "7d Delta",
          delta30d: "30d Delta",
          velocity: "Velocity",
          acceleration: "Accel",
          trend: "Trend",
        },
        perDay: "/day",
        diff: {
          title: "Summary",
          leader: "Leader",
          fastest: "Fastest Growing",
          mostGained: "Most Gained (7d)",
          gap: "Gap",
          versus: "vs",
          closing: "Closing",
          widening: "Widening",
        },
        trendLabels: { up: "Up", stable: "Stable", down: "Down" },
        correlation: {
          title: "Correlation Matrix",
        },
        presets: {
          title: "Presets",
          saveCurrent: "Save Current",
          namePlaceholder: "Preset name...",
          empty: "No saved presets",
          delete: "Delete",
        },
      },
      trends: {
        breakouts: {
          filter: "Breakouts Only",
          more: "+{count} more",
          types: {},
        },
      },
    },
  }),
}));

vi.mock("../../components/motion", () => ({
  AnimatedPage: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  FadeIn: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../components/Skeleton", () => ({
  Skeleton: () => <span data-testid="skeleton" />,
}));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  AreaChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Line: () => <div data-testid="chart-line" />,
  Area: () => <div data-testid="chart-area" />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Brush: () => <div data-testid="chart-brush" />,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// ==================== Helpers ====================

function makeRepo(overrides: Partial<RepoWithSignals> = {}): RepoWithSignals {
  return {
    id: 1,
    owner: "facebook",
    name: "react",
    full_name: "facebook/react",
    url: "https://github.com/facebook/react",
    description: "A JS library",
    language: "JavaScript",
    added_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
    stars: 200000,
    forks: 50000,
    stars_delta_7d: 100,
    stars_delta_30d: 400,
    velocity: 14.3,
    acceleration: 0.5,
    trend: 1,
    forks_delta_7d: null,
    forks_delta_30d: null,
    issues_delta_7d: null,
    issues_delta_30d: null,
    last_fetched: null,
    ...overrides,
  };
}

function makeDataPoint(overrides: Partial<ChartDataPoint> = {}): ChartDataPoint {
  return { date: "2024-01-01", stars: 100, forks: 10, open_issues: 0, ...overrides };
}

function makeComparisonRepo(overrides: Partial<ComparisonRepoData> = {}): ComparisonRepoData {
  return {
    repo_id: 1,
    repo_name: "facebook/react",
    color: "#2563eb",
    data_points: [makeDataPoint(), makeDataPoint({ date: "2024-01-02", stars: 110, forks: 12 })],
    current_stars: 200000,
    velocity: 14.3,
    acceleration: 0.5,
    trend: 1,
    stars_delta_7d: 100,
    stars_delta_30d: 400,
    issues_delta_7d: null,
    issues_delta_30d: null,
    ...overrides,
  };
}

// ==================== Tests ====================

describe("Compare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepos = [
      makeRepo({ id: 1, full_name: "facebook/react" }),
      makeRepo({ id: 2, full_name: "vuejs/vue" }),
      makeRepo({ id: 3, full_name: "angular/angular" }),
    ];
    mockComparisonReturn = {
      data: undefined,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    // Reset localStorage
    localStorage.removeItem("starscope-compare-repos");
  });

  it("renders page title and subtitle", () => {
    render(<Compare />);
    expect(screen.getByTestId("page-title")).toHaveTextContent("Compare");
    expect(screen.getByText("Compare star trends across repositories")).toBeInTheDocument();
  });

  it("renders RepoSelector with repos", () => {
    render(<Compare />);
    expect(screen.getByText("Select repositories to compare")).toBeInTheDocument();
    expect(screen.getByText("facebook/react")).toBeInTheDocument();
    expect(screen.getByText("vuejs/vue")).toBeInTheDocument();
  });

  it("shows min-repos hint when < 2 selected", () => {
    render(<Compare />);
    expect(screen.getByText("Select at least 2 repos")).toBeInTheDocument();
  });

  it("does not show chart controls when < 2 repos selected", () => {
    render(<Compare />);
    expect(screen.queryByText("30 days")).not.toBeInTheDocument();
    expect(screen.queryByText("Normalize (%)")).not.toBeInTheDocument();
  });

  it("shows loading skeleton while chart is loading", () => {
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2]));
    mockComparisonReturn = {
      data: undefined,
      isLoading: true,
      error: null,
      refetch: mockRefetch,
    };
    render(<Compare />);
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
  });

  it("renders chart when data is available", () => {
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2]));
    mockComparisonReturn = {
      data: {
        repos: [
          makeComparisonRepo({ repo_id: 1, repo_name: "facebook/react" }),
          makeComparisonRepo({ repo_id: 2, repo_name: "vuejs/vue", color: "#dc2626" }),
        ],
        time_range: "30d",
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<Compare />);
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });

  it("renders MetricsTable below chart", () => {
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2]));
    mockComparisonReturn = {
      data: {
        repos: [
          makeComparisonRepo({ repo_id: 1, repo_name: "facebook/react" }),
          makeComparisonRepo({ repo_id: 2, repo_name: "vuejs/vue", color: "#dc2626" }),
        ],
        time_range: "30d",
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<Compare />);
    expect(screen.getByText("Metrics")).toBeInTheDocument();
  });

  it("shows error message with retry button on API error", async () => {
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2]));
    mockComparisonReturn = {
      data: undefined,
      isLoading: false,
      error: new Error("Network failure"),
      refetch: mockRefetch,
    };
    render(<Compare />);

    expect(screen.getByText("Network failure")).toBeInTheDocument();
    const retryBtn = screen.getByTestId("compare-retry-btn");
    expect(retryBtn).toHaveTextContent("Retry");

    await userEvent.click(retryBtn);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("shows time range buttons when >= 2 repos selected", () => {
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2]));
    mockComparisonReturn = {
      data: undefined,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<Compare />);
    expect(screen.getByText("7 days")).toBeInTheDocument();
    expect(screen.getByText("30 days")).toBeInTheDocument();
    expect(screen.getByText("90 days")).toBeInTheDocument();
    expect(screen.getByText("All time")).toBeInTheDocument();
  });

  it("shows normalize checkbox when >= 2 repos selected", () => {
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2]));
    mockComparisonReturn = {
      data: undefined,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<Compare />);
    expect(screen.getByText("Normalize (%)")).toBeInTheDocument();
  });

  it("toggles repo selection on chip click", async () => {
    render(<Compare />);
    const chip = screen.getByText("facebook/react");
    await userEvent.click(chip);

    // After clicking, the chip should be selected (has × icon)
    expect(screen.getByText("×")).toBeInTheDocument();
  });

  it("shows noData message when chart data is empty", () => {
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2]));
    mockComparisonReturn = {
      data: { repos: [], time_range: "30d" },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<Compare />);
    expect(screen.getByText("No data available for selected time range")).toBeInTheDocument();
  });

  // ==================== Phase 2 Tests ====================

  it("shows metric toggle (Stars/Forks) when >= 2 repos selected", () => {
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2]));
    mockComparisonReturn = {
      data: undefined,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<Compare />);
    expect(screen.getByTestId("compare-metric-toggle")).toBeInTheDocument();
    expect(screen.getByText("Stars")).toBeInTheDocument();
    expect(screen.getByText("Forks")).toBeInTheDocument();
  });

  it("shows chart type toggle (Line/Area) when >= 2 repos selected", () => {
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2]));
    mockComparisonReturn = {
      data: undefined,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<Compare />);
    expect(screen.getByTestId("compare-chart-type-toggle")).toBeInTheDocument();
    expect(screen.getByText("Line")).toBeInTheDocument();
    expect(screen.getByText("Area")).toBeInTheDocument();
  });

  it("switches to area chart when Area button clicked", async () => {
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2]));
    mockComparisonReturn = {
      data: {
        repos: [
          makeComparisonRepo({ repo_id: 1, repo_name: "facebook/react" }),
          makeComparisonRepo({ repo_id: 2, repo_name: "vuejs/vue", color: "#dc2626" }),
        ],
        time_range: "30d",
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<Compare />);
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Area"));
    expect(screen.getByTestId("area-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
  });

  it("shows download button when >= 2 repos selected", () => {
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2]));
    mockComparisonReturn = {
      data: undefined,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<Compare />);
    expect(screen.getByTestId("compare-download-btn")).toBeInTheDocument();
  });

  // ==================== Phase 3 Tests ====================

  // ==================== Phase 4 Tests ====================

  it("renders DiffSummaryPanel when data is available", () => {
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2]));
    mockComparisonReturn = {
      data: {
        repos: [
          makeComparisonRepo({ repo_id: 1, repo_name: "facebook/react" }),
          makeComparisonRepo({ repo_id: 2, repo_name: "vuejs/vue", color: "#dc2626" }),
        ],
        time_range: "30d",
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<Compare />);
    expect(screen.getByTestId("diff-summary-panel")).toBeInTheDocument();
    expect(screen.getByText("Summary")).toBeInTheDocument();
  });

  // ==================== Phase 5 Tests ====================

  it("consumes preselectedIds from NavigationContext on mount", () => {
    mockNavigationState = { preselectedIds: [2, 3] };
    render(<Compare />);
    // consumeNavigationState should have been called
    expect(mockConsumeNavigationState).toHaveBeenCalled();
    // The chips for repo 2 and 3 should be selected (shown with ×)
    const removeButtons = screen.getAllByText("×");
    expect(removeButtons.length).toBe(2);
  });

  // ==================== Coverage Tests ====================

  it("caps localStorage repo ids to MAX_COMPARE_REPOS", () => {
    // Pre-seed 7 ids — should be capped to 5
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2, 3, 4, 5, 6, 7]));
    mockRepos = Array.from({ length: 7 }, (_, i) =>
      makeRepo({ id: i + 1, full_name: `org/repo-${i + 1}` })
    );
    render(<Compare />);
    const selectedChips = screen.getAllByText("×");
    expect(selectedChips.length).toBe(5);
  });

  it("caps preselectedIds from NavigationContext to MAX_COMPARE_REPOS", () => {
    // Already have 3 in localStorage, navigation brings 4 more → merged should cap at 5
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2, 3]));
    mockNavigationState = { preselectedIds: [4, 5, 6, 7] };
    mockRepos = Array.from({ length: 7 }, (_, i) =>
      makeRepo({ id: i + 1, full_name: `org/repo-${i + 1}` })
    );
    render(<Compare />);
    const selectedChips = screen.getAllByText("×");
    expect(selectedChips.length).toBe(5);
  });

  it("handles corrupted localStorage gracefully", () => {
    localStorage.setItem("starscope-compare-repos", "not-valid-json!!!");
    render(<Compare />);
    expect(screen.getByText("Select at least 2 repos")).toBeInTheDocument();
  });

  it("prunes all selectedIds when watchlist becomes empty", () => {
    // Pre-seed compare selection, then set repos to empty
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2]));
    mockRepos = [];
    render(<Compare />);

    // All should be pruned — no × chips
    expect(screen.queryAllByText("×").length).toBe(0);

    // localStorage should be updated to empty
    const raw = localStorage.getItem("starscope-compare-repos");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual([]);
  });

  it("prunes orphan selectedIds when repos change", () => {
    // Pre-seed with repo IDs where 999 doesn't exist in mockRepos
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2, 999]));
    render(<Compare />);

    // Only 1 and 2 exist in mockRepos, so 999 should be pruned
    const selectedChips = screen.getAllByText("×");
    expect(selectedChips.length).toBe(2);

    // localStorage should be updated
    const raw = localStorage.getItem("starscope-compare-repos");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual([1, 2]);
  });

  it("switches to Issues metric", async () => {
    localStorage.setItem("starscope-compare-repos", JSON.stringify([1, 2]));
    mockComparisonReturn = {
      data: {
        repos: [
          makeComparisonRepo({
            repo_id: 1,
            repo_name: "facebook/react",
            data_points: [
              makeDataPoint({ open_issues: 50 }),
              makeDataPoint({ date: "2024-01-02", open_issues: 55 }),
            ],
          }),
          makeComparisonRepo({
            repo_id: 2,
            repo_name: "vuejs/vue",
            color: "#dc2626",
            data_points: [
              makeDataPoint({ open_issues: 30 }),
              makeDataPoint({ date: "2024-01-02", open_issues: 35 }),
            ],
          }),
        ],
        time_range: "30d",
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<Compare />);
    await userEvent.click(screen.getByText("Issues"));
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });
});
