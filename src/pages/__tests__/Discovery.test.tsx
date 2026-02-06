import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Discovery } from "../Discovery";

let mockDiscoveryReturn: Record<string, unknown>;

vi.mock("../../hooks/useDiscovery", () => ({
  useDiscovery: () => mockDiscoveryReturn,
}));

vi.mock("../../hooks/useWatchlist", () => ({
  useWatchlist: () => ({
    repos: [],
    handleRefreshAll: vi.fn(),
  }),
}));

vi.mock("../../api/client", () => ({
  addRepo: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../components/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../components/motion", () => ({
  AnimatedPage: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("../../components/discovery", () => ({
  DiscoverySearchBar: ({ onSearch }: { onSearch: (q: string) => void }) => (
    <input
      data-testid="search-bar"
      placeholder="Search..."
      onChange={(e) => onSearch(e.target.value)}
    />
  ),
  TrendingFilters: () => <div data-testid="trending-filters" />,
  ActiveFilters: () => <div data-testid="active-filters" />,
  DiscoveryFilters: () => <div data-testid="discovery-filters" />,
  DiscoveryResults: ({ repos, hasSearched }: { repos: unknown[]; hasSearched: boolean }) => (
    <div data-testid="discovery-results">
      {hasSearched ? `${repos.length} results` : "Start searching"}
    </div>
  ),
  SavedFilters: () => <div data-testid="saved-filters" />,
}));

vi.mock("../../i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../i18n")>();
  return {
    ...actual,
    useI18n: () => ({
      t: {
        common: { loading: "Loading..." },
        discovery: {
          title: "Discovery",
          subtitle: "Explore GitHub repositories",
          trending: {
            today: "Today",
            thisWeek: "This Week",
            thisMonth: "This Month",
          },
        },
        toast: { error: "Error", repoAdded: "Repo added" },
      },
    }),
  };
});

describe("Discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoveryReturn = {
      repos: [],
      totalCount: 0,
      hasMore: false,
      loading: false,
      error: null,
      keyword: "",
      period: null,
      filters: { language: undefined },
      hasSearched: false,
      setKeyword: vi.fn(),
      setPeriod: vi.fn(),
      setFilters: vi.fn(),
      applySavedFilter: vi.fn(),
      removeKeyword: vi.fn(),
      removePeriod: vi.fn(),
      removeLanguage: vi.fn(),
      reset: vi.fn(),
      loadMore: vi.fn(),
    };
  });

  it("renders page title and search bar", () => {
    render(<Discovery />);
    expect(screen.getByText("Discovery")).toBeInTheDocument();
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
  });

  it("renders all filter sections", () => {
    render(<Discovery />);
    expect(screen.getByTestId("trending-filters")).toBeInTheDocument();
    expect(screen.getByTestId("active-filters")).toBeInTheDocument();
    expect(screen.getByTestId("discovery-filters")).toBeInTheDocument();
    expect(screen.getByTestId("saved-filters")).toBeInTheDocument();
  });

  it("shows initial state before search", () => {
    render(<Discovery />);
    expect(screen.getByText("Start searching")).toBeInTheDocument();
  });

  it("shows results after search", () => {
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [{ id: 1 }, { id: 2 }];
    render(<Discovery />);
    expect(screen.getByText("2 results")).toBeInTheDocument();
  });
});
