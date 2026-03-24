import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Watchlist } from "../Watchlist";
import type { RepoWithSignals } from "../../api/client";
import type { WatchlistState, WatchlistActions } from "../../contexts/WatchlistContext";

interface MockSelectors {
  displayedRepos: RepoWithSignals[];
  loadingRepoId: number | null;
  isRefreshing: boolean;
  isRecalculating: boolean;
  isInitializing: boolean;
}

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
    forks_delta_7d: null,
    forks_delta_30d: null,
    issues_delta_7d: null,
    issues_delta_30d: null,
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

let mockState: WatchlistState;
let mockActions: WatchlistActions;
let mockSelectors: MockSelectors;

vi.mock("../../contexts/AppStatusContext", () => ({
  useAppStatus: () => ({
    isOnline: true,
    level: "online",
    showBanner: false,
    bannerMessage: null,
    isSidecarUp: true,
  }),
}));

vi.mock("../../contexts/WatchlistContext", () => ({
  useWatchlistState: () => mockState,
  useWatchlistActions: () => mockActions,
}));

// noinspection JSUnusedGlobalSymbols — mock exports consumed by Watchlist component
vi.mock("../../hooks/selectors/useWatchlistSelectors", () => ({
  useFilteredRepos: () => mockSelectors.displayedRepos,
  useSortedFilteredRepos: () => mockSelectors.displayedRepos,
  useLoadingRepo: () => mockSelectors.loadingRepoId,
  useIsRefreshing: () => mockSelectors.isRefreshing,
  useIsRecalculating: () => mockSelectors.isRecalculating,
  useIsInitializing: () => mockSelectors.isInitializing,
}));

vi.mock("../../hooks/useWatchlistSort", () => ({
  useWatchlistSort: () => ({
    sortKey: "added_at",
    sortDirection: "desc",
    setSort: vi.fn(),
    restoreSort: vi.fn(),
  }),
}));

vi.mock("../../hooks/useSelectionMode", () => ({
  useSelectionMode: () => ({
    isActive: false,
    selectedIds: new Set(),
    selectedCount: 0,
    enter: vi.fn(),
    exit: vi.fn(),
    toggleSelection: vi.fn(),
    selectAll: vi.fn(),
    clearSelection: vi.fn(),
    reconcile: vi.fn(),
  }),
}));

vi.mock("../../hooks/useWatchlistBatchActions", () => ({
  useWatchlistBatchActions: () => ({
    batchAddToCategory: vi.fn(),
    batchRefresh: vi.fn(),
    batchRemove: vi.fn(),
    isProcessing: false,
  }),
}));

vi.mock("../../hooks/useCategoryTree", () => ({
  useCategoryTree: () => ({
    tree: [],
    loading: false,
    error: null,
    fetchCategories: vi.fn(),
    handleCreateCategory: vi.fn(),
    handleUpdateCategory: vi.fn(),
    handleDeleteCategory: vi.fn(),
  }),
}));

vi.mock("../../hooks/useViewMode", () => ({
  useViewMode: () => ({
    viewMode: "list",
    setViewMode: vi.fn(),
  }),
}));

vi.mock("../../hooks/useWindowedBatchRepoData", () => ({
  useWindowedBatchRepoData: () => ({
    dataMap: {},
    loading: false,
    error: null,
    setVisibleRange: vi.fn(),
  }),
}));

// noinspection JSUnusedGlobalSymbols
vi.mock("../../hooks/useCategoryOperations", () => ({
  useCategoryOperations: () => ({
    removeFromCategory: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock("../../components/motion", () => ({
  AnimatedPage: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("../../components/CategorySidebar", () => ({
  CategorySidebar: () => <div data-testid="category-sidebar" />,
}));

// noinspection JSUnusedGlobalSymbols
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

// noinspection JSUnusedGlobalSymbols
vi.mock("../../components/EmptyState", () => ({
  EmptyState: ({
    title,
    description,
  }: {
    title: string;
    description?: string;
    icon?: ReactNode;
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
    } as unknown as WatchlistActions;

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
    await user.click(screen.getByLabelText("Close"));
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
    expect(screen.getByText(/Showing \d+ of \d+ repos/)).toBeInTheDocument();
  });

  it("shows filter indicator when search query is active", () => {
    const repos = [makeRepo()];
    mockState.repos = repos;
    mockSelectors.displayedRepos = repos;
    mockState.filters.searchQuery = "react";
    render(<Watchlist />);
    expect(screen.getByText(/Showing \d+ of \d+ repos/)).toBeInTheDocument();
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

  it("renders virtual list for repos", () => {
    const repos = [
      makeRepo({ id: 1 }),
      makeRepo({ id: 2, full_name: "vuejs/vue" }),
      makeRepo({ id: 3, full_name: "angular/angular" }),
    ];
    mockState.repos = repos;
    mockSelectors.displayedRepos = repos;
    render(<Watchlist />);
    expect(screen.getByTestId("repo-card-1")).toBeInTheDocument();
    expect(screen.getByTestId("repo-card-2")).toBeInTheDocument();
    expect(screen.getByTestId("repo-card-3")).toBeInTheDocument();
  });

  it("shows page title with correct text", () => {
    render(<Watchlist />);
    expect(screen.getByTestId("page-title")).toHaveTextContent("StarScope");
  });
});
