import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
    github_id: null,
    language: "JavaScript",
    added_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-06-01T00:00:00Z",
    stars: 200000,
    forks: 40000,
    stars_delta_1d: 70,
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
    category_ids: [],
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
const mockSuccess = vi.fn();
const mockError = vi.fn();
const mockInfo = vi.fn();

let mockState: WatchlistState;
let mockActions: WatchlistActions;
let mockSelectors: MockSelectors;

const mockNavigateTo = vi.fn();
vi.mock("../../contexts/NavigationContext", () => ({
  useNavigation: () => ({
    navigateTo: mockNavigateTo,
    navigationState: null,
    consumeNavigationState: () => null,
  }),
}));

let mockLevel: "online" | "offline" = "online";
vi.mock("../../contexts/AppStatusContext", () => ({
  useAppStatus: () => ({
    isOnline: true,
    level: mockLevel,
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
// 只換掉 hook，findEmptySortKeys 保留真實實作——換成 stub 的話
// 「哪些排序鍵該停用」在這個檔裡就永遠是假的，測不出接線有沒有斷
vi.mock("../../hooks/selectors/useWatchlistSelectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/selectors/useWatchlistSelectors")>()),
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

const categoryTreeState = vi.hoisted(() => ({ reloadFailed: false }));
vi.mock("../../hooks/useCategoryTree", () => ({
  useCategoryTree: () => ({
    tree: [],
    loading: false,
    error: null,
    reloadFailed: categoryTreeState.reloadFailed,
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

const signalSummary = vi.hoisted(() => ({
  value: { data: undefined as { repos_with_signals: number } | undefined, isError: false },
}));
vi.mock("../../hooks/useSignalSummary", () => ({
  useSignalSummary: () => signalSummary.value,
}));

const batchLoader = vi.hoisted(() => ({
  reposVersion: 1,
  useReposQuery: vi.fn(),
  useWindowedBatchRepoData: vi.fn(),
}));

vi.mock("../../hooks/useReposQuery", () => ({
  useReposQuery: (options?: { enabled?: boolean }) => {
    batchLoader.useReposQuery(options);
    return { dataUpdatedAt: batchLoader.reposVersion };
  },
}));

vi.mock("../../hooks/useWindowedBatchRepoData", () => ({
  useWindowedBatchRepoData: (ids: number[], options?: unknown) => {
    batchLoader.useWindowedBatchRepoData(ids, options);
    return {
      dataMap: {},
      loading: false,
      error: null,
      setVisibleRange: vi.fn(),
    };
  },
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
  AddRepoDialog: ({ onAdd }: { onAdd: (input: string) => void }) => (
    <button data-testid="dialog-add" onClick={() => onAdd("o/n")} />
  ),
}));

vi.mock("../../components/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

// noinspection JSUnusedGlobalSymbols
vi.mock("../../components/EmptyState", () => ({
  EmptyState: ({
    title,
    description,
    actionLabel,
    onAction,
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
      {actionLabel && (
        <button data-testid="empty-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  ),
}));

describe("Watchlist", () => {
  beforeEach(() => {
    mockLevel = "online";
    signalSummary.value = { data: { repos_with_signals: 0 }, isError: false };
    categoryTreeState.reloadFailed = false;
    vi.clearAllMocks();

    mockState = {
      repos: [],
      loadingState: { type: "idle" },
      error: null,
      isConnected: true,
      reposLoad: { ready: true, failed: false, inProgress: false, retry: vi.fn() },
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
      },
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
      success: mockSuccess,
      error: mockError,
      info: mockInfo,
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

  it("says so when the category sidebar fails to reload", () => {
    // 側欄保留舊的樹（不整塊換成錯誤畫面）：新增分類後重讀失敗時，表單已關、側欄看不到新分類，
    // 不說的話使用者會以為沒建成功而再建一次
    mockState.repos = [makeRepo()];
    categoryTreeState.reloadFailed = true;

    render(<Watchlist />);

    expect(mockError).toHaveBeenCalledWith("Failed to load categories");
  });

  it("摘要的「有訊號」數整份清單，不是只數畫面上已載入的那幾張卡", () => {
    // 批次資料只載入可見範圍 ±10 張卡（這裡 mock 成一張都沒載入）；
    // 舊做法從批次資料數，訊號落在畫面外的 repo 就被算成 0
    mockState.repos = [makeRepo()];
    signalSummary.value = { data: { repos_with_signals: 2 }, isError: false };

    render(<Watchlist />);

    expect(screen.getByTestId("summary-signal-count")).toHaveTextContent("2");
  });

  it("訊號摘要還沒載到或載入失敗時顯示「—」，不是 0", () => {
    mockState.repos = [makeRepo()];
    signalSummary.value = { data: undefined, isError: true };

    render(<Watchlist />);

    expect(screen.getByTestId("summary-signal-count")).toHaveTextContent("—");
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

  it("says it is connecting to the engine, not that it shows cached data, while offline", () => {
    // 這個畫面只在資料引擎沒連上時出現，那時連線狀態不會是 offline（sidecar 的狀態排在斷網前面）：
    // 這條防的是有人再讓它依連線狀態換說法，不是重現一個走得到的情境
    mockLevel = "offline";
    mockState.isConnected = false;
    render(<Watchlist />);
    expect(screen.getByText("Connecting to StarScope engine. Please wait...")).toBeInTheDocument();
    expect(screen.queryByText(/Showing cached data/)).not.toBeInTheDocument();
  });

  it("shows empty state when no repos, routing to Discover as the primary path", async () => {
    const user = userEvent.setup();
    render(<Watchlist />);
    expect(screen.getByText("No repositories in your watchlist yet.")).toBeInTheDocument();
    // 主線是「feed → ⭐」；手動新增的入口在工具列，說明文字負責指路
    expect(screen.getByText(/Head over to Discover/)).toBeInTheDocument();
    await user.click(screen.getByTestId("empty-action"));
    expect(mockNavigateTo).toHaveBeenCalledWith("discovery");
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
    const repos = [makeRepo()];
    mockState.repos = repos;
    mockSelectors.displayedRepos = repos;

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
    expect(screen.getByTestId("page-title")).toHaveTextContent("Watchlist");
  });

  it("says the watchlist failed to load instead of claiming it is empty", () => {
    // 讀不到時說「追蹤清單中還沒有儲存庫」再給一顆去探索的按鈕，使用者會以為追蹤的專案不見了
    mockState.reposLoad = { ready: false, failed: true, inProgress: false, retry: vi.fn() };
    render(<Watchlist />);

    expect(screen.getByTestId("watchlist-load-error")).toHaveTextContent(
      "Couldn't load your watchlist."
    );
    expect(screen.queryByText("No repositories in your watchlist yet.")).not.toBeInTheDocument();
  });

  it("loads the watchlist again when retry is pressed on the load error", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    mockState.reposLoad = { ready: false, failed: true, inProgress: false, retry };
    render(<Watchlist />);

    await user.click(
      within(screen.getByTestId("watchlist-load-error")).getByRole("button", { name: "Retry" })
    );

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("keeps the repos on screen and says so when a reload fails", () => {
    const repos = [makeRepo({ id: 1 })];
    mockState.repos = repos;
    mockSelectors.displayedRepos = repos;
    mockState.reposLoad = { ready: true, failed: true, inProgress: false, retry: vi.fn() };
    render(<Watchlist />);

    expect(screen.getByTestId("watchlist-load-error")).toBeInTheDocument();
    expect(screen.getByTestId("repo-card-1")).toBeInTheDocument();
  });

  it("does not claim the watchlist is empty before it has been read", () => {
    // 查詢暫停時頁面照常畫出來，但追蹤清單還沒讀到
    mockState.reposLoad = { ready: false, failed: false, inProgress: false, retry: vi.fn() };
    render(<Watchlist />);

    expect(screen.queryByText("No repositories in your watchlist yet.")).not.toBeInTheDocument();
    expect(screen.queryByTestId("watchlist-load-error")).not.toBeInTheDocument();
  });

  it("does not claim the watchlist is empty when reloading an empty watchlist fails", () => {
    // 上一次讀到的是空清單，不代表現在還是空的
    mockState.reposLoad = { ready: true, failed: true, inProgress: false, retry: vi.fn() };
    render(<Watchlist />);

    expect(screen.getByTestId("watchlist-load-error")).toBeInTheDocument();
    expect(screen.queryByText("No repositories in your watchlist yet.")).not.toBeInTheDocument();
  });

  it("says a repo is already on the watchlist instead of claiming it was added", async () => {
    mockAddRepo.mockResolvedValue({ success: true, alreadyTracked: true });
    render(<Watchlist />);

    await userEvent.click(screen.getByTestId("dialog-add"));

    expect(mockInfo).toHaveBeenCalledWith("Already on your watchlist.");
    expect(mockSuccess).not.toHaveBeenCalled();
  });

  it("passes the tracked list's dataUpdatedAt to the batch loader as its data version", () => {
    // 卡片的訊號與徽章由批次載入另外抓：追蹤清單重讀過，就要讓它知道資料換了版本
    batchLoader.reposVersion = 111;
    const { rerender } = render(<Watchlist />);
    expect(batchLoader.useWindowedBatchRepoData).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ dataVersion: 111 })
    );

    batchLoader.reposVersion = 222;
    rerender(<Watchlist />);
    expect(batchLoader.useWindowedBatchRepoData).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({ dataVersion: 222 })
    );
    // 只讀版本：追蹤清單由 WatchlistContext 讀，這裡不另外發請求
    expect(batchLoader.useReposQuery).toHaveBeenCalledWith({ enabled: false });
  });
});
