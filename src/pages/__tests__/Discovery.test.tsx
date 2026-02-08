import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Discovery } from "../Discovery";

const mockAddRepo = vi.fn().mockResolvedValue({});
const mockSuccess = vi.fn();
const mockError = vi.fn();
const mockHandleRefreshAll = vi.fn();

let mockDiscoveryReturn: Record<string, unknown>;
let mockWatchlistRepos: { full_name: string }[];

vi.mock("../../hooks/useDiscovery", () => ({
  useDiscovery: () => mockDiscoveryReturn,
}));

vi.mock("../../hooks/useWatchlist", () => ({
  useWatchlist: () => ({
    state: { repos: mockWatchlistRepos },
    actions: { refreshAll: mockHandleRefreshAll },
  }),
}));

vi.mock("../../api/client", () => ({
  addRepo: (...args: unknown[]) => mockAddRepo(...args),
}));

vi.mock("../../components/Toast", () => ({
  useToast: () => ({ success: mockSuccess, error: mockError }),
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
  TrendingFilters: ({
    onSelectPeriod,
    activePeriod,
  }: {
    onSelectPeriod: (p: string) => void;
    activePeriod: string | null;
  }) => (
    <div data-testid="trending-filters">
      <button data-testid="period-daily" onClick={() => onSelectPeriod("daily")}>
        Daily
      </button>
      <span data-testid="active-period">{activePeriod ?? "none"}</span>
    </div>
  ),
  ActiveFilters: ({
    keyword,
    period,
    language,
    onRemoveKeyword,
    onRemovePeriod,
    onRemoveLanguage,
    onClearAll,
  }: {
    keyword?: string;
    period?: string;
    language?: string;
    onRemoveKeyword: () => void;
    onRemovePeriod: () => void;
    onRemoveLanguage: () => void;
    onClearAll: () => void;
  }) => (
    <div data-testid="active-filters">
      {keyword && (
        <span data-testid="active-keyword">
          {keyword}
          <button data-testid="remove-keyword" onClick={onRemoveKeyword}>
            x
          </button>
        </span>
      )}
      {period && (
        <span data-testid="active-period-label">
          {period}
          <button data-testid="remove-period" onClick={onRemovePeriod}>
            x
          </button>
        </span>
      )}
      {language && (
        <span data-testid="active-language">
          {language}
          <button data-testid="remove-language" onClick={onRemoveLanguage}>
            x
          </button>
        </span>
      )}
      <button data-testid="clear-all" onClick={onClearAll}>
        Clear All
      </button>
    </div>
  ),
  DiscoveryFilters: () => <div data-testid="discovery-filters" />,
  DiscoveryResults: ({
    repos,
    hasSearched,
    watchlistFullNames,
    onAddToWatchlist,
    addingRepoId,
  }: {
    repos: { id: number; full_name: string; owner: string; name: string }[];
    hasSearched: boolean;
    watchlistFullNames: Set<string>;
    onAddToWatchlist: (repo: {
      id: number;
      full_name: string;
      owner: string;
      name: string;
    }) => void;
    addingRepoId: number | null;
  }) => (
    <div data-testid="discovery-results">
      {hasSearched ? `${repos.length} results` : "Start searching"}
      {repos.map((r) => (
        <div key={r.id} data-testid={`result-${r.id}`}>
          {r.full_name}
          {watchlistFullNames.has(r.full_name.toLowerCase()) ? (
            <span data-testid={`in-watchlist-${r.id}`}>In Watchlist</span>
          ) : (
            <button
              data-testid={`add-btn-${r.id}`}
              onClick={() => onAddToWatchlist(r)}
              disabled={addingRepoId === r.id}
            >
              Add
            </button>
          )}
        </div>
      ))}
    </div>
  ),
  SavedFilters: () => <div data-testid="saved-filters" />,
}));

describe("Discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWatchlistRepos = [];
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
    expect(screen.getByText("Discover")).toBeInTheDocument();
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
    mockDiscoveryReturn.repos = [
      { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
      { id: 2, full_name: "vuejs/vue", owner: "vuejs", name: "vue" },
    ];
    render(<Discovery />);
    expect(screen.getByText("2 results")).toBeInTheDocument();
  });

  it("passes getPeriodLabel result to ActiveFilters when period is set", () => {
    mockDiscoveryReturn.period = "daily";
    render(<Discovery />);
    expect(screen.getByTestId("active-period-label")).toHaveTextContent("Today");
  });

  it("passes 'This Week' label for weekly period", () => {
    mockDiscoveryReturn.period = "weekly";
    render(<Discovery />);
    expect(screen.getByTestId("active-period-label")).toHaveTextContent("This week");
  });

  it("passes 'This Month' label for monthly period", () => {
    mockDiscoveryReturn.period = "monthly";
    render(<Discovery />);
    expect(screen.getByTestId("active-period-label")).toHaveTextContent("This month");
  });

  it("does not show period label when period is null", () => {
    render(<Discovery />);
    expect(screen.queryByTestId("active-period-label")).not.toBeInTheDocument();
  });

  it("passes keyword to ActiveFilters when keyword is set", () => {
    mockDiscoveryReturn.keyword = "react";
    render(<Discovery />);
    expect(screen.getByTestId("active-keyword")).toHaveTextContent("react");
  });

  it("does not show keyword filter when keyword is empty", () => {
    mockDiscoveryReturn.keyword = "";
    render(<Discovery />);
    expect(screen.queryByTestId("active-keyword")).not.toBeInTheDocument();
  });

  it("calls discovery.reset when clear all is clicked", async () => {
    const user = userEvent.setup();
    render(<Discovery />);
    await user.click(screen.getByTestId("clear-all"));
    expect(mockDiscoveryReturn.reset).toHaveBeenCalled();
  });

  it("adds repo to watchlist successfully", async () => {
    const user = userEvent.setup();
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [
      { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
    ];
    render(<Discovery />);
    await user.click(screen.getByTestId("add-btn-1"));
    expect(mockAddRepo).toHaveBeenCalledWith({ owner: "facebook", name: "react" });
    expect(mockSuccess).toHaveBeenCalledWith("Repository added to watchlist");
  });

  it("shows error toast when add to watchlist fails", async () => {
    const user = userEvent.setup();
    mockAddRepo.mockRejectedValueOnce(new Error("fail"));
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [
      { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
    ];
    render(<Discovery />);
    await user.click(screen.getByTestId("add-btn-1"));
    expect(mockError).toHaveBeenCalledWith("An error occurred");
  });

  it("shows in-watchlist state for repos already in watchlist", () => {
    mockWatchlistRepos = [{ full_name: "facebook/react" }];
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [
      { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
    ];
    render(<Discovery />);
    expect(screen.getByTestId("in-watchlist-1")).toBeInTheDocument();
  });

  it("passes language filter to ActiveFilters", () => {
    mockDiscoveryReturn.filters = { language: "TypeScript" };
    render(<Discovery />);
    expect(screen.getByTestId("active-language")).toHaveTextContent("TypeScript");
  });

  it("calls removeKeyword when keyword remove button is clicked", async () => {
    const user = userEvent.setup();
    mockDiscoveryReturn.keyword = "react";
    render(<Discovery />);
    await user.click(screen.getByTestId("remove-keyword"));
    expect(mockDiscoveryReturn.removeKeyword).toHaveBeenCalled();
  });

  it("calls removePeriod when period remove button is clicked", async () => {
    const user = userEvent.setup();
    mockDiscoveryReturn.period = "daily";
    render(<Discovery />);
    await user.click(screen.getByTestId("remove-period"));
    expect(mockDiscoveryReturn.removePeriod).toHaveBeenCalled();
  });

  it("calls removeLanguage when language remove button is clicked", async () => {
    const user = userEvent.setup();
    mockDiscoveryReturn.filters = { language: "Python" };
    render(<Discovery />);
    await user.click(screen.getByTestId("remove-language"));
    expect(mockDiscoveryReturn.removeLanguage).toHaveBeenCalled();
  });
});
