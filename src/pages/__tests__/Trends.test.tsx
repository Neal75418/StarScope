import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Trends } from "../Trends";
import type { TrendingRepo } from "../../hooks/useTrends";

const mockSetSortBy = vi.fn();
const mockRetry = vi.fn();

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
  addRepo: vi.fn().mockResolvedValue({}),
  getRepos: vi.fn().mockResolvedValue({ repos: [] }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("../../i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../i18n")>();
  return {
    ...actual,
    useI18n: () => ({
      t: {
        common: { loading: "Loading..." },
        trends: {
          title: "Trends",
          subtitle: "Trending repositories",
          loadingError: "Failed to load",
          retry: "Retry",
          empty: "No trending repos",
          sortOptions: {
            velocity: "Velocity",
            stars_delta_7d: "7d Stars",
            stars_delta_30d: "30d Stars",
            acceleration: "Acceleration",
          },
          columns: {
            rank: "#",
            repo: "Repository",
            stars: "Stars",
            delta7d: "7d",
            delta30d: "30d",
            velocity: "Vel",
          },
          filters: {
            allLanguages: "All Languages",
            minStars: "Min Stars",
            addToWatchlist: "Add",
            inWatchlist: "In Watchlist",
          },
        },
        repo: { trend: "Trend" },
      },
    }),
  };
});

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
    mockTrendsReturn = {
      trends: [],
      loading: false,
      error: null,
      sortBy: "velocity",
      setSortBy: mockSetSortBy,
      languageFilter: "",
      setLanguageFilter: vi.fn(),
      minStarsFilter: null,
      setMinStarsFilter: vi.fn(),
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
    expect(screen.getByText("No trending repos")).toBeInTheDocument();
  });
});
