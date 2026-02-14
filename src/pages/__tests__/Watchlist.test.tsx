import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Watchlist } from "../Watchlist";
import type { RepoWithSignals } from "../../api/client";

function makeRepo(overrides: Partial<RepoWithSignals> = {}): RepoWithSignals {
  return {
    id: 1,
    owner: "facebook",
    name: "react",
    full_name: "facebook/react",
    url: "https://github.com/facebook/react",
    description: "A JavaScript library",
    language: "JavaScript",
    added_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-06-01T00:00:00Z",
    stars: 200000,
    forks: 40000,
    stars_delta_7d: 500,
    stars_delta_30d: 2000,
    velocity: 71.4,
    acceleration: 5.2,
    trend: 1,
    last_fetched: "2024-06-01T00:00:00Z",
    ...overrides,
  };
}

const mockHandleRetry = vi.fn();
const mockOpenDialog = vi.fn();
const mockCloseDialog = vi.fn();
const mockAddRepo = vi.fn();
const mockHandleRefreshAll = vi.fn();
const mockHandleRecalculateAll = vi.fn();
const mockClearError = vi.fn();
const mockSetSearchQuery = vi.fn();
const mockSetCategory = vi.fn();
const mockOpenRemoveConfirm = vi.fn();
const mockConfirmRemove = vi.fn();
const mockCancelRemove = vi.fn();
const mockFetchRepo = vi.fn();
const mockDismissToast = vi.fn();
const mockSuccess = vi.fn();
const mockError = vi.fn();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockState: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockActions: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockSelectors: any;

vi.mock("../../contexts/WatchlistContext", () => ({
  useWatchlistState: () => mockState,
  useWatchlistActions: () => mockActions,
}));

vi.mock("../../hooks/selectors/useWatchlistSelectors", () => ({
  useFilteredRepos: () => mockSelectors.displayedRepos,
  useLoadingRepo: () => mockSelectors.loadingRepoId,
  useIsRefreshing: () => mockSelectors.isRefreshing,
  useIsRecalculating: () => mockSelectors.isRecalculating,
  useIsInitializing: () => mockSelectors.isInitializing,
}));

vi.mock("../../hooks/useWindowedBatchRepoData", () => ({
  useWindowedBatchRepoData: () => ({
    dataMap: {},
    loading: false,
    error: null,
    setVisibleRange: vi.fn(),
  }),
}));

vi.mock("../../hooks/useCategoryOperations", () => ({
  useCategoryOperations: () => ({
    removeFromCategory: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock("../../components/motion", () => ({
  AnimatedPage: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("../../components/CategorySidebar", () => ({
  CategorySidebar: () => <div data-testid="category-sidebar" />,
}));

vi.mock("../../components/RepoCard", () => ({
  RepoCard: ({ repo }: { repo: RepoWithSignals }) => (
    <div data-testid={`repo-card-${repo.id}`}>{repo.full_name}</div>
  ),
}));

vi.mock("../../components/AddRepoDialog", () => ({
  AddRepoDialog: () => null,
}));

vi.mock("../../components/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

vi.mock("../../components/Toast", () => ({
  ToastContainer: () => null,
  useToast: () => ({ toasts: [], dismissToast: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../components/EmptyState", () => ({
  EmptyState: ({
    title,
    description,
  }: {
    title: string;
    description?: string;
    icon?: React.ReactNode;
    actionLabel?: string;
    onAction?: () => void;
  }) => (
    <div data-testid="empty-inner">
      <span>{title}</span>
      {description && <span>{description}</span>}
    </div>
  ),
}));

describe("Watchlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockState = {
      repos: [],
      loadingState: { type: "idle" },
      error: null,
      isConnected: true,
      ui: {
        dialog: {
          isOpen: false,
          error: null,
        },
        removeConfirm: {
          isOpen: false,
          repoId: null,
          repoName: "",
        },
      },
      filters: {
        selectedCategoryId: null,
        searchQuery: "",
        categoryRepoIds: null,
      },
      toasts: [],
    };

    mockActions = {
      addRepo: mockAddRepo.mockResolvedValue({ success: true }),
      removeRepo: vi.fn(),
      fetchRepo: mockFetchRepo,
      refreshAll: mockHandleRefreshAll,
      recalculateAll: mockHandleRecalculateAll,
      openDialog: mockOpenDialog,
      closeDialog: mockCloseDialog,
      openRemoveConfirm: mockOpenRemoveConfirm,
      closeRemoveConfirm: vi.fn(),
      confirmRemove: mockConfirmRemove,
      cancelRemove: mockCancelRemove,
      setCategory: mockSetCategory,
      setSearchQuery: mockSetSearchQuery,
      showToast: vi.fn(),
      dismissToast: mockDismissToast,
      success: mockSuccess,
      error: mockError,
      info: vi.fn(),
      warning: vi.fn(),
      clearError: mockClearError,
      retry: mockHandleRetry,
    };

    mockSelectors = {
      displayedRepos: [],
      loadingRepoId: null,
      isRefreshing: false,
      isRecalculating: false,
      isInitializing: false,
    };
  });

  it("shows loading state", () => {
    mockSelectors.isInitializing = true;
    render(<Watchlist />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows connection error with retry button", async () => {
    const user = userEvent.setup();
    mockState.isConnected = false;
    render(<Watchlist />);
    expect(screen.getByText("Connecting...")).toBeInTheDocument();
    expect(
      screen.getByText("The app will automatically retry the connection.")
    ).toBeInTheDocument();
    await user.click(screen.getByText("Retry Now"));
    expect(mockHandleRetry).toHaveBeenCalled();
  });

  it("shows empty state when no repos", () => {
    render(<Watchlist />);
    expect(screen.getByText("No repositories in your watchlist yet.")).toBeInTheDocument();
    expect(
      screen.getByText('Click "Add Repository" to start tracking GitHub projects.')
    ).toBeInTheDocument();
  });

  it("renders repo cards when repos exist", () => {
    const repos = [makeRepo({ id: 1 }), makeRepo({ id: 2, full_name: "vuejs/vue" })];
    mockState.repos = repos;
    mockSelectors.displayedRepos = repos;
    render(<Watchlist />);
    expect(screen.getByText("facebook/react")).toBeInTheDocument();
    expect(screen.getByText("vuejs/vue")).toBeInTheDocument();
  });

  it("renders toolbar with add and refresh buttons", () => {
    render(<Watchlist />);
    expect(screen.getByLabelText("Add Repository")).toBeInTheDocument();
    expect(screen.getByLabelText("Refresh All")).toBeInTheDocument();
  });

  it("shows error banner and clears it on click", async () => {
    const user = userEvent.setup();
    mockState.error = "Something went wrong";
    render(<Watchlist />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    await user.click(screen.getByText("x"));
    expect(mockClearError).toHaveBeenCalled();
  });

  it("shows 'no results' empty state when search has no matches", () => {
    mockState.repos = [makeRepo()];
    mockSelectors.displayedRepos = [];
    mockState.filters.searchQuery = "nonexistent";
    render(<Watchlist />);
    expect(screen.getByText("No repositories match your search.")).toBeInTheDocument();
  });

  it("shows 'no category' empty state when category filter has no matches", () => {
    mockState.repos = [makeRepo()];
    mockSelectors.displayedRepos = [];
    mockState.filters.selectedCategoryId = 5;
    mockState.filters.searchQuery = "";
    render(<Watchlist />);
    expect(screen.getByText("No repositories in this category.")).toBeInTheDocument();
  });

  it("shows filter indicator when category is selected", () => {
    const repos = [makeRepo()];
    mockState.repos = repos;
    mockSelectors.displayedRepos = repos;
    mockState.filters.selectedCategoryId = 3;
    render(<Watchlist />);
    expect(screen.getByText("Showing 1 of 1 repos")).toBeInTheDocument();
  });

  it("shows filter indicator when search query is active", () => {
    const repos = [makeRepo()];
    mockState.repos = repos;
    mockSelectors.displayedRepos = repos;
    mockState.filters.searchQuery = "react";
    render(<Watchlist />);
    expect(screen.getByText("Showing 1 of 1 repos")).toBeInTheDocument();
  });

  it("calls openAddDialog when Add Repo button is clicked", async () => {
    const user = userEvent.setup();
    render(<Watchlist />);
    await user.click(screen.getByTestId("add-repo-btn"));
    expect(mockOpenDialog).toHaveBeenCalled();
  });

  it("calls handleRefreshAll when Refresh All button is clicked", async () => {
    const user = userEvent.setup();
    render(<Watchlist />);
    await user.click(screen.getByTestId("refresh-all-btn"));
    expect(mockHandleRefreshAll).toHaveBeenCalled();
  });

  it("shows 'Refreshing...' when isRefreshing is true", () => {
    mockSelectors.isRefreshing = true;
    render(<Watchlist />);
    expect(screen.getByText("Refreshing...")).toBeInTheDocument();
  });

  it("shows 'Calculating...' when isRecalculating is true", () => {
    mockSelectors.isRecalculating = true;
    render(<Watchlist />);
    expect(screen.getByText("Calculating...")).toBeInTheDocument();
  });

  it("renders search input", () => {
    render(<Watchlist />);
    expect(screen.getByTestId("watchlist-search")).toBeInTheDocument();
  });

  it("renders category sidebar", () => {
    render(<Watchlist />);
    expect(screen.getByTestId("category-sidebar")).toBeInTheDocument();
  });
});
