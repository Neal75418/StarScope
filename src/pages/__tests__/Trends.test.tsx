import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Trends } from "../Trends";
import type { ReactNode } from "react";
import type { TrendingRepo } from "../../api/client";

const mockSetSortBy = vi.fn();
const mockSetLanguageFilter = vi.fn();
const mockSetMinStarsFilter = vi.fn();
const mockRetry = vi.fn();
const mockAddRepo = vi.fn().mockResolvedValue({});
const mockSetViewMode = vi.fn();
let mockViewMode = "list";
let mockWatchlistRepos: Array<{ full_name: string }> = [];

let mockTrendsReturn: {
  trends: TrendingRepo[];
  loading: boolean;
  error: string | null;
  sortBy: string;
  setSortBy: (s: string) => void;
  languageFilter: string;
  setLanguageFilter: (s: string) => void;
  minStarsFilter: number | null;
  setMinStarsFilter: (n: number | null) => void;
  availableLanguages: string[];
  retry: () => void;
  dataUpdatedAt: number;
};

vi.mock("../../hooks/useTrends", () => ({
  useTrends: () => mockTrendsReturn,
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

vi.mock("../../api/client", () => ({
  addRepo: (...args: unknown[]) => mockAddRepo(...args),
  batchAddRepos: vi.fn().mockResolvedValue({ success: 1, failed: 0, total: 1 }),
  getExportTrendsJsonUrl: (sortBy: string) => `/api/export/trends.json?sort_by=${sortBy}`,
  getExportTrendsCsvUrl: (sortBy: string) => `/api/export/trends.csv?sort_by=${sortBy}`,
}));

vi.mock("../../contexts/WatchlistContext", () => ({
  useWatchlistState: () => ({ repos: mockWatchlistRepos }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("../../components/motion", () => ({
  AnimatedPage: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("../../components/Skeleton", () => ({
  Skeleton: () => <span data-testid="skeleton" />,
}));

vi.mock("../../components/TrendArrow", () => ({
  TrendArrow: ({ trend }: { trend: number | null }) => (
    <span data-testid="trend-arrow">{trend ?? "—"}</span>
  ),
}));

vi.mock("../../components/StarsChart", () => ({
  StarsChart: ({ repoId }: { repoId: number }) => (
    <div data-testid="stars-chart">Chart for {repoId}</div>
  ),
}));

vi.mock("../../hooks/useViewMode", () => ({
  useViewMode: () => ({ viewMode: mockViewMode, setViewMode: mockSetViewMode }),
}));

vi.mock("../../hooks/useClickOutside", () => ({
  useClickOutside: vi.fn(),
}));

const mockNavigateTo = vi.fn();
vi.mock("../../contexts/NavigationContext", () => ({
  useNavigation: () => ({
    navigateTo: mockNavigateTo,
    navigationState: null,
    consumeNavigationState: () => null,
  }),
}));

const mockUseTrendEarlySignals = vi.fn().mockReturnValue({
  signalsByRepoId: {},
  loading: false,
  reposWithBreakouts: new Set(),
});

vi.mock("../../hooks/useTrendEarlySignals", () => ({
  useTrendEarlySignals: (...args: unknown[]) => mockUseTrendEarlySignals(...args),
}));

function makeTrending(overrides: Partial<TrendingRepo> = {}): TrendingRepo {
  return {
    id: 1,
    owner: "facebook",
    name: "react",
    full_name: "facebook/react",
    url: "https://github.com/facebook/react",
    description: "A JS library",
    language: "JavaScript",
    stars: 200000,
    stars_delta_7d: 500,
    stars_delta_30d: 2000,
    velocity: 71.4,
    acceleration: 5.2,
    trend: 1,
    forks_delta_7d: null,
    forks_delta_30d: null,
    issues_delta_7d: null,
    issues_delta_30d: null,
    rank: 1,
    ...overrides,
  };
}

function renderTrends() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Trends />
    </QueryClientProvider>
  );
}

describe("Trends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewMode = "list";
    mockWatchlistRepos = [];
    mockUseTrendEarlySignals.mockReturnValue({
      signalsByRepoId: {},
      loading: false,
      reposWithBreakouts: new Set(),
    });
    mockTrendsReturn = {
      trends: [],
      loading: false,
      error: null,
      sortBy: "velocity",
      setSortBy: mockSetSortBy,
      languageFilter: "",
      setLanguageFilter: mockSetLanguageFilter,
      minStarsFilter: null,
      setMinStarsFilter: mockSetMinStarsFilter,
      availableLanguages: ["JavaScript", "Python"],
      retry: mockRetry,
      dataUpdatedAt: Date.now(),
    };
  });

  it("shows loading skeletons", () => {
    mockTrendsReturn.loading = true;
    renderTrends();
    expect(screen.getByText("Trends")).toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("shows error state with retry", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.error = "Server error";
    renderTrends();
    expect(screen.getByText("Server error")).toBeInTheDocument();
    await user.click(screen.getByText("Retry"));
    expect(mockRetry).toHaveBeenCalled();
  });

  it("renders trends table with data", () => {
    mockTrendsReturn.trends = [
      makeTrending(),
      makeTrending({ id: 2, rank: 2, full_name: "vuejs/vue" }),
    ];
    renderTrends();
    expect(screen.getByTestId("trends-table")).toBeInTheDocument();
    expect(screen.getByText("facebook/react")).toBeInTheDocument();
    expect(screen.getByText("vuejs/vue")).toBeInTheDocument();
  });

  it("renders sort tabs", () => {
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    expect(screen.getByTestId("sort-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("sort-velocity")).toBeInTheDocument();
    expect(screen.getByTestId("sort-stars_delta_7d")).toBeInTheDocument();
  });

  it("shows empty state when no trends", () => {
    renderTrends();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText("No trending repositories found.")).toBeInTheDocument();
  });

  it("calls setSortBy when sort tab is clicked", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    await user.click(screen.getByTestId("sort-stars_delta_7d"));
    expect(mockSetSortBy).toHaveBeenCalledWith("stars_delta_7d");
  });

  it("renders language filter select with available languages", () => {
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    const langSelect = screen.getByLabelText("Filter by language");
    expect(langSelect).toBeInTheDocument();
    // JavaScript appears both as repo language badge and as select option
    expect(screen.getAllByText("JavaScript").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Python")).toBeInTheDocument();
  });

  it("calls setLanguageFilter when language is selected", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    await user.selectOptions(screen.getByLabelText("Filter by language"), "JavaScript");
    expect(mockSetLanguageFilter).toHaveBeenCalledWith("JavaScript");
  });

  it("renders min stars filter select", () => {
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    const starsSelect = screen.getByLabelText("Minimum stars");
    expect(starsSelect).toBeInTheDocument();
  });

  it("calls setMinStarsFilter when stars option is selected", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    await user.selectOptions(screen.getByLabelText("Minimum stars"), "1000");
    expect(mockSetMinStarsFilter).toHaveBeenCalledWith(1000);
  });

  it("calls setMinStarsFilter with null when empty option is selected", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    mockTrendsReturn.minStarsFilter = 1000;
    renderTrends();
    await user.selectOptions(screen.getByLabelText("Minimum stars"), "");
    expect(mockSetMinStarsFilter).toHaveBeenCalledWith(null);
  });

  it("renders repo row with language badge", () => {
    mockTrendsReturn.trends = [makeTrending({ language: "TypeScript" })];
    renderTrends();
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
  });

  it("does not render language badge when language is null", () => {
    mockTrendsReturn.trends = [makeTrending({ language: null })];
    renderTrends();
    // No .repo-language badge should be rendered in the table row
    const langBadges = document.querySelectorAll(".repo-language");
    expect(langBadges.length).toBe(0);
  });

  it("shows dash for null velocity", () => {
    mockTrendsReturn.trends = [makeTrending({ velocity: null })];
    renderTrends();
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("shows formatted velocity for non-null value", () => {
    mockTrendsReturn.trends = [makeTrending({ velocity: 71.4 })];
    renderTrends();
    expect(screen.getByText("71.4/day")).toBeInTheDocument();
  });

  it("shows 'In Watchlist' for repos already tracked", () => {
    mockWatchlistRepos = [{ full_name: "facebook/react" }];
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    expect(screen.getByText("In Watchlist")).toBeInTheDocument();
  });

  it("calls addRepo when Add button is clicked", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    const addBtn = screen.getByText("+ Watchlist");
    await user.click(addBtn);
    expect(mockAddRepo).toHaveBeenCalledWith({ owner: "facebook", name: "react" });
  });

  it("renders all four sort tabs with correct labels", () => {
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    // "Stars/Day" appears both in sort tab and column header, so use getAllByText
    expect(screen.getAllByText("Stars/Day").length).toBeGreaterThanOrEqual(1);
    // "7d Delta" and "30d Delta" appear in both sort tabs and column headers
    expect(screen.getAllByText("7d Delta").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("30d Delta").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Acceleration")).toBeInTheDocument();
  });

  it("marks active sort tab with aria-selected", () => {
    mockTrendsReturn.trends = [makeTrending()];
    mockTrendsReturn.sortBy = "stars_delta_30d";
    renderTrends();
    expect(screen.getByTestId("sort-stars_delta_30d")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("sort-velocity")).toHaveAttribute("aria-selected", "false");
  });

  it("expands a row when clicked and shows chart", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    await user.click(screen.getByTestId("trend-row-1"));
    expect(screen.getByTestId("trend-expanded-1")).toBeInTheDocument();
    expect(screen.getByTestId("stars-chart")).toBeInTheDocument();
  });

  it("collapses expanded row when clicked again", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    await user.click(screen.getByTestId("trend-row-1"));
    expect(screen.getByTestId("trend-expanded-1")).toBeInTheDocument();
    await user.click(screen.getByTestId("trend-row-1"));
    expect(screen.queryByTestId("trend-expanded-1")).not.toBeInTheDocument();
  });

  it("only expands one row at a time", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [
      makeTrending({ id: 1, rank: 1 }),
      makeTrending({ id: 2, rank: 2, full_name: "vuejs/vue" }),
    ];
    renderTrends();
    await user.click(screen.getByTestId("trend-row-1"));
    expect(screen.getByTestId("trend-expanded-1")).toBeInTheDocument();
    await user.click(screen.getByTestId("trend-row-2"));
    expect(screen.queryByTestId("trend-expanded-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("trend-expanded-2")).toBeInTheDocument();
  });

  it("closes expanded row via close button", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    await user.click(screen.getByTestId("trend-row-1"));
    expect(screen.getByTestId("trend-expanded-1")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Collapse"));
    expect(screen.queryByTestId("trend-expanded-1")).not.toBeInTheDocument();
  });

  it("renders view mode toggle", () => {
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    expect(screen.getByTestId("view-mode-toggle")).toBeInTheDocument();
    expect(screen.getByLabelText("List")).toBeInTheDocument();
    expect(screen.getByLabelText("Grid")).toBeInTheDocument();
  });

  it("shows grid view when viewMode is grid", () => {
    mockViewMode = "grid";
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    expect(screen.getByTestId("trends-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("trends-table")).not.toBeInTheDocument();
  });

  it("shows list view when viewMode is list", () => {
    mockViewMode = "list";
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    expect(screen.getByTestId("trends-table")).toBeInTheDocument();
    expect(screen.queryByTestId("trends-grid")).not.toBeInTheDocument();
  });

  it("renders trend cards in grid view with rank badge", () => {
    mockViewMode = "grid";
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    expect(screen.getByTestId("trend-card-1")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
  });

  it("calls setViewMode when grid button is clicked", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    await user.click(screen.getByLabelText("Grid"));
    expect(mockSetViewMode).toHaveBeenCalledWith("grid");
  });

  // Phase 3: Export + Selection + Batch
  it("renders export dropdown button", () => {
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    expect(screen.getByTestId("trends-export-btn")).toBeInTheDocument();
  });

  it("renders selection enter button", () => {
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    expect(screen.getByTestId("trends-selection-enter")).toBeInTheDocument();
    expect(screen.getByText("Select")).toBeInTheDocument();
  });

  it("enters selection mode and shows checkboxes", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    await user.click(screen.getByTestId("trends-selection-enter"));
    // Should switch to exit button
    expect(screen.getByTestId("trends-selection-exit")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    // Should show checkbox in table row
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("exits selection mode when Done is clicked", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    await user.click(screen.getByTestId("trends-selection-enter"));
    expect(screen.getByTestId("trends-selection-exit")).toBeInTheDocument();
    await user.click(screen.getByTestId("trends-selection-exit"));
    expect(screen.getByTestId("trends-selection-enter")).toBeInTheDocument();
  });

  it("shows batch bar when items are selected", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    // Enter selection mode
    await user.click(screen.getByTestId("trends-selection-enter"));
    // Click checkbox to select
    const checkbox = screen.getByRole("checkbox");
    await user.click(checkbox);
    // Batch bar should appear
    expect(screen.getByTestId("trends-batch-bar")).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("shows checkboxes in grid view during selection mode", async () => {
    const user = userEvent.setup();
    mockViewMode = "grid";
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    await user.click(screen.getByTestId("trends-selection-enter"));
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  // Phase 5: Breakout filter
  it("shows breakouts filter button when signals exist", () => {
    mockTrendsReturn.trends = [makeTrending()];
    mockUseTrendEarlySignals.mockReturnValue({
      signalsByRepoId: { 1: [{ id: 1, signal_type: "breakout", acknowledged: false }] },
      loading: false,
      reposWithBreakouts: new Set([1]),
    });
    renderTrends();
    expect(screen.getByTestId("trends-breakouts-filter")).toBeInTheDocument();
    expect(screen.getByText(/Breakouts Only/)).toBeInTheDocument();
  });

  it("hides breakouts filter button when no signals", () => {
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    expect(screen.queryByTestId("trends-breakouts-filter")).not.toBeInTheDocument();
  });

  it("filters trends by breakout repos when filter is active", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [
      makeTrending({ id: 1, rank: 1, full_name: "facebook/react" }),
      makeTrending({ id: 2, rank: 2, full_name: "vuejs/vue" }),
    ];
    mockUseTrendEarlySignals.mockReturnValue({
      signalsByRepoId: { 1: [{ id: 1, signal_type: "breakout", acknowledged: false }] },
      loading: false,
      reposWithBreakouts: new Set([1]),
    });
    renderTrends();
    // Both repos visible initially
    expect(screen.getByText("facebook/react")).toBeInTheDocument();
    expect(screen.getByText("vuejs/vue")).toBeInTheDocument();
    // Click breakouts filter
    await user.click(screen.getByTestId("trends-breakouts-filter"));
    // Only repo with breakout shown
    expect(screen.getByText("facebook/react")).toBeInTheDocument();
    expect(screen.queryByText("vuejs/vue")).not.toBeInTheDocument();
  });

  // Phase 6: Auto-refresh
  it("renders auto-refresh controls", () => {
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    expect(screen.getByTestId("trends-refresh-controls")).toBeInTheDocument();
    expect(screen.getByTestId("trends-refresh-select")).toBeInTheDocument();
  });

  it("shows Off as default auto-refresh value", () => {
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    const select = screen.getByTestId("trends-refresh-select") as HTMLSelectElement;
    expect(select.value).toBe("false");
  });

  it("changes auto-refresh interval when selected", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    renderTrends();
    await user.selectOptions(screen.getByTestId("trends-refresh-select"), "300000");
    const select = screen.getByTestId("trends-refresh-select") as HTMLSelectElement;
    expect(select.value).toBe("300000");
  });

  it("shows last updated text when auto-refresh is active", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    mockTrendsReturn.dataUpdatedAt = Date.now();
    renderTrends();
    await user.selectOptions(screen.getByTestId("trends-refresh-select"), "300000");
    expect(screen.getByTestId("trends-last-updated")).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });
});
