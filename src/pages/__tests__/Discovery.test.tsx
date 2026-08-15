import type { ReactNode, RefObject } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Discovery } from "../Discovery";

const mockAddRepo = vi.fn().mockResolvedValue({});
const mockSuccess = vi.fn();
const mockError = vi.fn();
const mockHandleRefreshAll = vi.fn();
const mockInvalidateRepos = vi.fn();
const mockUnstarRepo = vi.fn();

let mockDiscoveryReturn: Record<string, unknown>;
let mockWatchlistRepos: { id: number; full_name: string }[];

// noinspection JSUnusedGlobalSymbols
vi.mock("../../hooks/useDiscovery", () => ({
  useDiscovery: () => mockDiscoveryReturn,
}));

vi.mock("../../contexts/WatchlistContext", () => ({
  useWatchlistState: () => ({
    repos: mockWatchlistRepos,
    loadingState: { type: "idle" },
    error: null,
    isConnected: true,
    ui: {
      dialog: { isOpen: false, error: null },
      removeConfirm: { isOpen: false, repoId: null, repoName: "" },
    },
    filters: { selectedCategoryId: null, searchQuery: "", categoryRepoIds: null },
    toasts: [],
  }),
  useWatchlistActions: () => ({
    refreshAll: mockHandleRefreshAll,
    invalidateRepos: mockInvalidateRepos,
    success: mockSuccess,
    error: mockError,
    addRepo: mockAddRepo,
    removeRepo: vi.fn(),
    fetchRepo: vi.fn(),
    recalculateAll: vi.fn(),
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
    openRemoveConfirm: vi.fn(),
    closeRemoveConfirm: vi.fn(),
    confirmRemove: vi.fn(),
    cancelRemove: vi.fn(),
    setCategory: vi.fn(),
    setSearchQuery: vi.fn(),
    showToast: vi.fn(),
    dismissToast: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    clearError: vi.fn(),
    retry: vi.fn(),
  }),
}));

vi.mock("../../api/client", () => ({
  addRepo: (...args: unknown[]) => mockAddRepo(...args),
  unstarRepo: (...args: unknown[]) => mockUnstarRepo(...args),
}));

vi.mock("../../components/Toast", () => ({
  useToast: () => ({ success: mockSuccess, error: mockError }),
}));

vi.mock("../../components/motion", () => ({
  AnimatedPage: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// noinspection JSUnusedGlobalSymbols
vi.mock("../../components/discovery", () => ({
  DiscoverySearchBar: ({
    onSearch,
    inputRef,
  }: {
    onSearch: (q: string) => void;
    inputRef?: RefObject<HTMLInputElement | null>;
  }) => (
    <input
      ref={inputRef}
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
    addingRepoIds,
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
    addingRepoIds: Set<number>;
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
              disabled={addingRepoIds.has(r.id)}
            >
              Add
            </button>
          )}
        </div>
      ))}
    </div>
  ),
  RecommendedForYou: () => null,
  BatchAddBar: () => null,
  // 讓 mock 能觸發真正的 handler：Discovery 的 feed 處理邏輯（要不要重抓全部）
  // 只有在這裡才測得到
  ForYouFeed: ({
    onAddToWatchlist,
    onUnstar,
  }: {
    onAddToWatchlist: (item: { owner: string; name: string; full_name: string }) => void;
    onUnstar: (item: { full_name: string }) => void;
  }) => (
    <div data-testid="for-you-feed">
      <button
        data-testid="stub-feed-add"
        onClick={() => onAddToWatchlist({ owner: "a", name: "one", full_name: "a/one" })}
      />
      <button data-testid="stub-feed-unstar" onClick={() => onUnstar({ full_name: "a/one" })} />
    </div>
  ),
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
      removeKeyword: vi.fn(),
      removePeriod: vi.fn(),
      removeLanguage: vi.fn(),
      removeTopic: vi.fn(),
      removeMinStars: vi.fn(),
      removeMaxStars: vi.fn(),
      removeLicense: vi.fn(),
      removeHideArchived: vi.fn(),
      reset: vi.fn(),
      loadMore: vi.fn(),
    };
  });

  it("renders page title and search bar", () => {
    render(<Discovery />);
    expect(screen.getByText("Discover")).toBeInTheDocument();
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
  });

  it("renders all filter sections in search mode", () => {
    mockDiscoveryReturn.keyword = "react";
    render(<Discovery />);
    expect(screen.getByTestId("trending-filters")).toBeInTheDocument();
    expect(screen.getByTestId("active-filters")).toBeInTheDocument();
    expect(screen.getByTestId("discovery-filters")).toBeInTheDocument();
  });

  it("hides active filters in feed mode (they do not apply to the feed)", () => {
    render(<Discovery />);
    expect(screen.getByTestId("for-you-feed")).toBeInTheDocument();
    expect(screen.queryByTestId("active-filters")).not.toBeInTheDocument();
  });

  it("shows the For You feed by default when there is no search keyword", () => {
    render(<Discovery />);
    expect(screen.getByTestId("for-you-feed")).toBeInTheDocument();
    expect(screen.queryByTestId("discovery-results")).not.toBeInTheDocument();
  });

  it("clicking a trending period switches from the For You feed to search results", async () => {
    const user = userEvent.setup();
    // useDiscovery 在此檔案是完整 mock（非 reactive）；先設好 period，模擬真實 hook 在
    // setPeriod("daily") 後、下次渲染會回傳的狀態。
    mockDiscoveryReturn.period = "daily";
    render(<Discovery />);
    expect(screen.getByTestId("for-you-feed")).toBeInTheDocument();

    await user.click(screen.getByTestId("period-daily"));

    expect(mockDiscoveryReturn.setPeriod).toHaveBeenCalledWith("daily");
    expect(screen.getByTestId("discovery-results")).toBeInTheDocument();
    expect(screen.queryByTestId("for-you-feed")).not.toBeInTheDocument();
  });

  it("clearing all filters after browsing trending returns to the For You feed", async () => {
    const user = userEvent.setup();
    mockDiscoveryReturn.period = "daily";
    render(<Discovery />);

    await user.click(screen.getByTestId("period-daily"));
    expect(screen.getByTestId("discovery-results")).toBeInTheDocument();

    await user.click(screen.getByTestId("clear-all"));

    expect(mockDiscoveryReturn.reset).toHaveBeenCalled();
    expect(screen.getByTestId("for-you-feed")).toBeInTheDocument();
    expect(screen.queryByTestId("discovery-results")).not.toBeInTheDocument();
  });

  it("removing the period chip individually (not Clear all) returns to the For You feed", async () => {
    const user = userEvent.setup();
    mockDiscoveryReturn.period = "daily";
    const { rerender } = render(<Discovery />);

    await user.click(screen.getByTestId("period-daily"));
    expect(screen.getByTestId("discovery-results")).toBeInTheDocument();

    await user.click(screen.getByTestId("remove-period"));
    expect(mockDiscoveryReturn.removePeriod).toHaveBeenCalled();

    // 同上：手動同步 removePeriod 後 period 應變成的值（真實 hook 的 setPeriod(undefined)），
    // 並重新渲染，驗證「未按 Clear all、只移除 period chip」也能回到 feed。
    mockDiscoveryReturn.period = null;
    rerender(<Discovery />);

    expect(screen.getByTestId("for-you-feed")).toBeInTheDocument();
    expect(screen.queryByTestId("discovery-results")).not.toBeInTheDocument();
  });

  it("shows initial state before search", () => {
    // 有關鍵字才會渲染 DiscoveryResults；此處驗證 DiscoveryResults 自身尚未搜尋完成時的狀態
    mockDiscoveryReturn.keyword = "react";
    render(<Discovery />);
    expect(screen.getByText("Start searching")).toBeInTheDocument();
  });

  it("shows results after search", () => {
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [
      { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
      { id: 2, full_name: "vuejs/vue", owner: "vuejs", name: "vue" },
    ];
    render(<Discovery />);
    expect(screen.getByText("2 results")).toBeInTheDocument();
  });

  it("passes getPeriodLabel result to ActiveFilters when period is set", () => {
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.period = "daily";
    render(<Discovery />);
    expect(screen.getByTestId("active-period-label")).toHaveTextContent("Today");
  });

  it("passes 'This Week' label for weekly period", () => {
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.period = "weekly";
    render(<Discovery />);
    expect(screen.getByTestId("active-period-label")).toHaveTextContent("This week");
  });

  it("passes 'This Month' label for monthly period", () => {
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.period = "monthly";
    render(<Discovery />);
    expect(screen.getByTestId("active-period-label")).toHaveTextContent("This month");
  });

  it("does not show period label when period is null", () => {
    mockDiscoveryReturn.keyword = "react";
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
    mockDiscoveryReturn.keyword = "react";
    render(<Discovery />);
    await user.click(screen.getByTestId("clear-all"));
    expect(mockDiscoveryReturn.reset).toHaveBeenCalled();
  });

  it("adds repo to watchlist successfully", async () => {
    const user = userEvent.setup();
    mockDiscoveryReturn.keyword = "react";
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
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [
      { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
    ];
    render(<Discovery />);
    await user.click(screen.getByTestId("add-btn-1"));
    expect(mockError).toHaveBeenCalledWith("An error occurred");
  });

  it("shows in-watchlist state for repos already in watchlist", () => {
    mockWatchlistRepos = [{ id: 1, full_name: "facebook/react" }];
    mockDiscoveryReturn.keyword = "react";
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
    mockDiscoveryReturn.keyword = "react";
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

  describe("keyboard shortcut: /", () => {
    it("focuses search input when / key is pressed", () => {
      render(<Discovery />);
      const searchInput = screen.getByTestId("search-bar");
      expect(document.activeElement).not.toBe(searchInput);

      fireEvent.keyDown(document, { key: "/" });
      expect(document.activeElement).toBe(searchInput);
    });

    it("does not steal focus when / is typed inside another input", () => {
      // guard 的意義：在別的輸入框打「/」（例如打路徑）不能被搶去搜尋框。
      // 必須用「另一個」input 測——按在搜尋框自己身上時 focus() 是 no-op，測不到 guard。
      render(
        <>
          <input data-testid="other-input" />
          <Discovery />
        </>
      );
      const otherInput = screen.getByTestId("other-input");
      const searchInput = screen.getByTestId("search-bar");
      otherInput.focus();

      fireEvent.keyDown(otherInput, { key: "/" });

      expect(document.activeElement).toBe(otherInput);
      expect(document.activeElement).not.toBe(searchInput);
    });

    it("does not focus search when modifier key is held", () => {
      render(<Discovery />);
      const searchInput = screen.getByTestId("search-bar");
      expect(document.activeElement).not.toBe(searchInput);

      fireEvent.keyDown(document, { key: "/", metaKey: true });
      expect(document.activeElement).not.toBe(searchInput);

      fireEvent.keyDown(document, { key: "/", ctrlKey: true });
      expect(document.activeElement).not.toBe(searchInput);

      fireEvent.keyDown(document, { key: "/", altKey: true });
      expect(document.activeElement).not.toBe(searchInput);
    });
  });

  describe("feed 動作不該重抓整份追蹤清單", () => {
    it("unstarring invalidates the list instead of refetching every repo", async () => {
      // refreshAll 會對每一個追蹤中的 repo 各打一次 GitHub。追蹤 95 個時，
      // 取消一個要等 95 次請求跑完畫面才變——實際遇到過，使用者以為沒反應。
      mockWatchlistRepos = [{ id: 7, full_name: "a/one" }];
      mockUnstarRepo.mockResolvedValue(undefined);
      render(<Discovery />);

      fireEvent.click(screen.getByTestId("stub-feed-unstar"));

      await waitFor(() => expect(mockUnstarRepo).toHaveBeenCalledWith(7));
      expect(mockInvalidateRepos).toHaveBeenCalled();
      expect(mockHandleRefreshAll).not.toHaveBeenCalled();
    });

    it("adding invalidates the list instead of refetching every repo", async () => {
      mockWatchlistRepos = [];
      mockAddRepo.mockResolvedValue({ id: 8 });
      render(<Discovery />);

      fireEvent.click(screen.getByTestId("stub-feed-add"));

      await waitFor(() => expect(mockAddRepo).toHaveBeenCalled());
      expect(mockInvalidateRepos).toHaveBeenCalled();
      expect(mockHandleRefreshAll).not.toHaveBeenCalled();
    });
  });
});
