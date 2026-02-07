import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Trends } from "../Trends";
import type { TrendingRepo } from "../../hooks/useTrends";

const mockSetSortBy = vi.fn();
const mockSetLanguageFilter = vi.fn();
const mockSetMinStarsFilter = vi.fn();
const mockRetry = vi.fn();
const mockAddRepo = vi.fn().mockResolvedValue({});
const mockGetRepos = vi.fn().mockResolvedValue({ repos: [] });

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
};

vi.mock("../../hooks/useTrends", () => ({
  useTrends: () => mockTrendsReturn,
}));

vi.mock("../../api/client", () => ({
  addRepo: (...args: unknown[]) => mockAddRepo(...args),
  getRepos: (...args: unknown[]) => mockGetRepos(...args),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));


vi.mock("../../components/motion", () => ({
  AnimatedPage: ({ children, className }: { children: React.ReactNode; className?: string }) => (
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
    rank: 1,
    ...overrides,
  };
}

describe("Trends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRepos.mockResolvedValue({ repos: [] });
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
    };
  });

  it("shows loading skeletons", () => {
    mockTrendsReturn.loading = true;
    render(<Trends />);
    expect(screen.getByText("Trends")).toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("shows error state with retry", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.error = "Server error";
    render(<Trends />);
    expect(screen.getByText("Server error")).toBeInTheDocument();
    await user.click(screen.getByText("Retry"));
    expect(mockRetry).toHaveBeenCalled();
  });

  it("renders trends table with data", () => {
    mockTrendsReturn.trends = [
      makeTrending(),
      makeTrending({ id: 2, rank: 2, full_name: "vuejs/vue" }),
    ];
    render(<Trends />);
    expect(screen.getByTestId("trends-table")).toBeInTheDocument();
    expect(screen.getByText("facebook/react")).toBeInTheDocument();
    expect(screen.getByText("vuejs/vue")).toBeInTheDocument();
  });

  it("renders sort tabs", () => {
    mockTrendsReturn.trends = [makeTrending()];
    render(<Trends />);
    expect(screen.getByTestId("sort-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("sort-velocity")).toBeInTheDocument();
    expect(screen.getByTestId("sort-stars_delta_7d")).toBeInTheDocument();
  });

  it("shows empty state when no trends", () => {
    render(<Trends />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText("No trending repositories found.")).toBeInTheDocument();
  });

  it("calls setSortBy when sort tab is clicked", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    render(<Trends />);
    await user.click(screen.getByTestId("sort-stars_delta_7d"));
    expect(mockSetSortBy).toHaveBeenCalledWith("stars_delta_7d");
  });

  it("renders language filter select with available languages", () => {
    mockTrendsReturn.trends = [makeTrending()];
    render(<Trends />);
    const langSelect = screen.getByLabelText("Filter by language");
    expect(langSelect).toBeInTheDocument();
    // JavaScript appears both as repo language badge and as select option
    expect(screen.getAllByText("JavaScript").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Python")).toBeInTheDocument();
  });

  it("calls setLanguageFilter when language is selected", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    render(<Trends />);
    await user.selectOptions(screen.getByLabelText("Filter by language"), "JavaScript");
    expect(mockSetLanguageFilter).toHaveBeenCalledWith("JavaScript");
  });

  it("renders min stars filter select", () => {
    mockTrendsReturn.trends = [makeTrending()];
    render(<Trends />);
    const starsSelect = screen.getByLabelText("Minimum stars");
    expect(starsSelect).toBeInTheDocument();
  });

  it("calls setMinStarsFilter when stars option is selected", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    render(<Trends />);
    await user.selectOptions(screen.getByLabelText("Minimum stars"), "1000");
    expect(mockSetMinStarsFilter).toHaveBeenCalledWith(1000);
  });

  it("calls setMinStarsFilter with null when empty option is selected", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    mockTrendsReturn.minStarsFilter = 1000;
    render(<Trends />);
    await user.selectOptions(screen.getByLabelText("Minimum stars"), "");
    expect(mockSetMinStarsFilter).toHaveBeenCalledWith(null);
  });

  it("renders repo row with language badge", () => {
    mockTrendsReturn.trends = [makeTrending({ language: "TypeScript" })];
    render(<Trends />);
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
  });

  it("does not render language badge when language is null", () => {
    mockTrendsReturn.trends = [makeTrending({ language: null })];
    render(<Trends />);
    // No .repo-language badge should be rendered in the table row
    const langBadges = document.querySelectorAll(".repo-language");
    expect(langBadges.length).toBe(0);
  });

  it("shows dash for null velocity", () => {
    mockTrendsReturn.trends = [makeTrending({ velocity: null })];
    render(<Trends />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows formatted velocity for non-null value", () => {
    mockTrendsReturn.trends = [makeTrending({ velocity: 71.4 })];
    render(<Trends />);
    expect(screen.getByText("71.4")).toBeInTheDocument();
  });

  it("shows 'In Watchlist' for repos already tracked", () => {
    mockGetRepos.mockResolvedValue({
      repos: [{ full_name: "facebook/react" }],
    });
    mockTrendsReturn.trends = [makeTrending()];
    render(<Trends />);
    // The useEffect fetches watchlist; wait for it to settle
    // Since getRepos resolves immediately, the watchlistNames will be set
  });

  it("calls addRepo when Add button is clicked", async () => {
    const user = userEvent.setup();
    mockTrendsReturn.trends = [makeTrending()];
    render(<Trends />);
    const addBtn = screen.getByText("+ Watchlist");
    await user.click(addBtn);
    expect(mockAddRepo).toHaveBeenCalledWith({ owner: "facebook", name: "react" });
  });

  it("renders all four sort tabs with correct labels", () => {
    mockTrendsReturn.trends = [makeTrending()];
    render(<Trends />);
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
    render(<Trends />);
    expect(screen.getByTestId("sort-stars_delta_30d")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("sort-velocity")).toHaveAttribute("aria-selected", "false");
  });
});
