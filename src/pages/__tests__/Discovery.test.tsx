import type { ReactNode, RefObject } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Discovery } from "../Discovery";
import { ToastProvider } from "../../components/Toast";
import { ApiError } from "../../api/types";
import { BATCH_ADD_FOLLOWUP_INTERVAL_MS, BATCH_ADD_TIMEOUT_MS } from "../../constants/api";

// 用真的 ToastProvider：mock 掉 useToast 只能驗「有呼叫」，看不出訊息有沒有出現在畫面上
function renderDiscovery() {
  return render(
    <ToastProvider>
      <Discovery />
    </ToastProvider>
  );
}

const mockAddRepo = vi.fn().mockResolvedValue({});
const mockHandleRefreshAll = vi.fn();
const mockInvalidateRepos = vi.fn();
const mockUnstarRepo = vi.fn();

let mockDiscoveryReturn: Record<string, unknown>;
let mockWatchlistRepos: { id: number; full_name: string; github_id?: number | null }[];

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
    filters: { selectedCategoryId: null, searchQuery: "" },
  }),
  useWatchlistActions: () => ({
    refreshAll: mockHandleRefreshAll,
    invalidateRepos: mockInvalidateRepos,
    success: vi.fn(),
    error: vi.fn(),
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
    watchlistGithubIds,
    onAddToWatchlist,
    addingRepoIds,
  }: {
    repos: { id: number; full_name: string; owner: string; name: string }[];
    hasSearched: boolean;
    watchlistFullNames: Set<string>;
    watchlistGithubIds?: Set<number>;
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
          {watchlistFullNames.has(r.full_name.toLowerCase()) || watchlistGithubIds?.has(r.id) ? (
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
    watchlistFullNames,
    watchlistGithubIds,
  }: {
    onAddToWatchlist: (item: {
      owner: string;
      name: string;
      full_name: string;
      github_id?: number;
    }) => void;
    onUnstar: (item: { full_name: string; github_id?: number }) => void;
    watchlistFullNames: Set<string>;
    watchlistGithubIds?: Set<number>;
  }) => (
    <div data-testid="for-you-feed">
      <span data-testid="feed-github-ids">{[...(watchlistGithubIds ?? [])].join(",")}</span>
      <span data-testid="feed-full-names">{[...watchlistFullNames].sort().join(",")}</span>
      <button
        data-testid="stub-feed-add-stale"
        onClick={() =>
          onAddToWatchlist({ owner: "a", name: "old", full_name: "a/old", github_id: 77 })
        }
      />
      <button
        data-testid="stub-feed-unstar-stale"
        onClick={() => onUnstar({ full_name: "a/old", github_id: 77 })}
      />
      <button
        data-testid="stub-feed-add"
        onClick={() => onAddToWatchlist({ owner: "a", name: "one", full_name: "a/one" })}
      />
      <button data-testid="stub-feed-unstar" onClick={() => onUnstar({ full_name: "a/one" })} />
      <button
        data-testid="stub-feed-unstar-renamed"
        onClick={() => onUnstar({ full_name: "a/new", github_id: 77 })}
      />
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
    renderDiscovery();
    expect(screen.getByText("Discover")).toBeInTheDocument();
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
  });

  it("renders all filter sections in search mode", () => {
    mockDiscoveryReturn.keyword = "react";
    renderDiscovery();
    expect(screen.getByTestId("trending-filters")).toBeInTheDocument();
    expect(screen.getByTestId("active-filters")).toBeInTheDocument();
    expect(screen.getByTestId("discovery-filters")).toBeInTheDocument();
  });

  it("hides active filters in feed mode (they do not apply to the feed)", () => {
    renderDiscovery();
    expect(screen.getByTestId("for-you-feed")).toBeInTheDocument();
    expect(screen.queryByTestId("active-filters")).not.toBeInTheDocument();
  });

  it("shows the For You feed by default when there is no search keyword", () => {
    renderDiscovery();
    expect(screen.getByTestId("for-you-feed")).toBeInTheDocument();
    expect(screen.queryByTestId("discovery-results")).not.toBeInTheDocument();
  });

  it("clicking a trending period switches from the For You feed to search results", async () => {
    const user = userEvent.setup();
    // useDiscovery 在此檔案是完整 mock（非 reactive）；先設好 period，模擬真實 hook 在
    // setPeriod("daily") 後、下次渲染會回傳的狀態。
    mockDiscoveryReturn.period = "daily";
    renderDiscovery();
    expect(screen.getByTestId("for-you-feed")).toBeInTheDocument();

    await user.click(screen.getByTestId("period-daily"));

    expect(mockDiscoveryReturn.setPeriod).toHaveBeenCalledWith("daily");
    expect(screen.getByTestId("discovery-results")).toBeInTheDocument();
    expect(screen.queryByTestId("for-you-feed")).not.toBeInTheDocument();
  });

  it("clearing all filters after browsing trending returns to the For You feed", async () => {
    const user = userEvent.setup();
    mockDiscoveryReturn.period = "daily";
    renderDiscovery();

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
    const { rerender } = renderDiscovery();

    await user.click(screen.getByTestId("period-daily"));
    expect(screen.getByTestId("discovery-results")).toBeInTheDocument();

    await user.click(screen.getByTestId("remove-period"));
    expect(mockDiscoveryReturn.removePeriod).toHaveBeenCalled();

    // 同上：手動同步 removePeriod 後 period 應變成的值（真實 hook 的 setPeriod(undefined)），
    // 並重新渲染，驗證「未按 Clear all、只移除 period chip」也能回到 feed。
    mockDiscoveryReturn.period = null;
    rerender(
      <ToastProvider>
        <Discovery />
      </ToastProvider>
    );

    expect(screen.getByTestId("for-you-feed")).toBeInTheDocument();
    expect(screen.queryByTestId("discovery-results")).not.toBeInTheDocument();
  });

  it("shows initial state before search", () => {
    // 有關鍵字才會渲染 DiscoveryResults；此處驗證 DiscoveryResults 自身尚未搜尋完成時的狀態
    mockDiscoveryReturn.keyword = "react";
    renderDiscovery();
    expect(screen.getByText("Start searching")).toBeInTheDocument();
  });

  it("shows results after search", () => {
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [
      { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
      { id: 2, full_name: "vuejs/vue", owner: "vuejs", name: "vue" },
    ];
    renderDiscovery();
    expect(screen.getByText("2 results")).toBeInTheDocument();
  });

  it("passes getPeriodLabel result to ActiveFilters when period is set", () => {
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.period = "daily";
    renderDiscovery();
    expect(screen.getByTestId("active-period-label")).toHaveTextContent("Today");
  });

  it("passes 'This Week' label for weekly period", () => {
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.period = "weekly";
    renderDiscovery();
    expect(screen.getByTestId("active-period-label")).toHaveTextContent("This week");
  });

  it("passes 'This Month' label for monthly period", () => {
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.period = "monthly";
    renderDiscovery();
    expect(screen.getByTestId("active-period-label")).toHaveTextContent("This month");
  });

  it("does not show period label when period is null", () => {
    mockDiscoveryReturn.keyword = "react";
    renderDiscovery();
    expect(screen.queryByTestId("active-period-label")).not.toBeInTheDocument();
  });

  it("passes keyword to ActiveFilters when keyword is set", () => {
    mockDiscoveryReturn.keyword = "react";
    renderDiscovery();
    expect(screen.getByTestId("active-keyword")).toHaveTextContent("react");
  });

  it("does not show keyword filter when keyword is empty", () => {
    mockDiscoveryReturn.keyword = "";
    renderDiscovery();
    expect(screen.queryByTestId("active-keyword")).not.toBeInTheDocument();
  });

  it("calls discovery.reset when clear all is clicked", async () => {
    const user = userEvent.setup();
    mockDiscoveryReturn.keyword = "react";
    renderDiscovery();
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
    renderDiscovery();
    await user.click(screen.getByTestId("add-btn-1"));
    expect(mockAddRepo).toHaveBeenCalledWith({ owner: "facebook", name: "react" });
    expect(await screen.findByText("Repository added to watchlist")).toBeInTheDocument();
  });

  it("shows error toast when add to watchlist fails", async () => {
    const user = userEvent.setup();
    mockAddRepo.mockRejectedValueOnce(new Error("fail"));
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [
      { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
    ];
    renderDiscovery();
    await user.click(screen.getByTestId("add-btn-1"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Not added to your watchlist. Try again."
    );
  });

  it.each([
    [
      "the repository is gone from GitHub",
      new ApiError(404, "Resource not found: PUT star facebook/react", "GITHUB_NOT_FOUND"),
      "Not added to your watchlist. GitHub can't find this repository — it may have been deleted, renamed or made private.",
    ],
    [
      "GitHub's quota is used up",
      new ApiError(429, "GitHub API rate limit exceeded.", "GITHUB_RATE_LIMIT"),
      "Not added to your watchlist. GitHub's API quota is used up. Try again later.",
    ],
    [
      "the saved GitHub sign-in is no longer accepted",
      new ApiError(502, "GitHub API error: authentication failed", "GITHUB_AUTH_FAILED"),
      "Not added to your watchlist. GitHub rejected the saved sign-in — it may have expired or been revoked. Reconnect GitHub in Settings.",
    ],
  ])("says why adding failed when %s", async (_label, error, message) => {
    const user = userEvent.setup();
    mockAddRepo.mockRejectedValueOnce(error);
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [
      { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
    ];
    renderDiscovery();
    await user.click(screen.getByTestId("add-btn-1"));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("says the repository is already tracked instead of reporting a failure", async () => {
    // 後端說「已經在追蹤清單」：結果就是使用者要的，不是失敗；卡片也要跟著變成已追蹤
    const user = userEvent.setup();
    mockAddRepo.mockRejectedValueOnce(
      new ApiError(400, "Repository facebook/react is already in your watchlist", "ALREADY_TRACKED")
    );
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [
      { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
    ];
    renderDiscovery();

    await user.click(screen.getByTestId("add-btn-1"));

    await waitFor(() =>
      expect(document.querySelector(".toast-info")).toHaveTextContent("Already on your watchlist.")
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("in-watchlist-1")).toBeInTheDocument();
    expect(mockInvalidateRepos).toHaveBeenCalled();
  });

  it("rereads the watchlist after a failed add", async () => {
    // 有些失敗其實代表清單已經變了（逾時後伺服器做完、別處加過）：不重讀的話畫面停在舊的
    const user = userEvent.setup();
    mockAddRepo.mockRejectedValueOnce(new ApiError(500, "Internal Server Error"));
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [
      { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
    ];
    renderDiscovery();

    await user.click(screen.getByTestId("add-btn-1"));

    await screen.findByRole("alert");
    expect(mockInvalidateRepos).toHaveBeenCalledTimes(1);
  });

  it("keeps rereading the watchlist for a while after an add times out", async () => {
    // 提示說清單會自己更新：伺服器可能晚一點才做完，只讀一次會停在做完之前的樣子
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockAddRepo.mockRejectedValueOnce(new ApiError(0, "Request timed out"));
      mockDiscoveryReturn.keyword = "react";
      mockDiscoveryReturn.hasSearched = true;
      mockDiscoveryReturn.repos = [
        { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
      ];
      renderDiscovery();

      await user.click(screen.getByTestId("add-btn-1"));
      // 逾時的情境都在 fake timers 底下跑：後續的定期重讀是真的計時器的話，會留在 worker 裡干擾後面的測試
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "No response yet, so it's unclear whether it was added. Your watchlist will update on its own over the next few minutes."
      );
      const rightAfter = mockInvalidateRepos.mock.calls.length;

      await vi.advanceTimersByTimeAsync(BATCH_ADD_FOLLOWUP_INTERVAL_MS);
      expect(mockInvalidateRepos.mock.calls.length).toBe(rightAfter + 1);

      // 有期限：不會一直讀下去
      await vi.advanceTimersByTimeAsync(BATCH_ADD_TIMEOUT_MS);
      const afterWindow = mockInvalidateRepos.mock.calls.length;
      await vi.advanceTimersByTimeAsync(BATCH_ADD_TIMEOUT_MS);
      expect(mockInvalidateRepos.mock.calls.length).toBe(afterWindow);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not schedule more rereads after an ordinary failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockAddRepo.mockRejectedValueOnce(new ApiError(502, "Upstream service unreachable"));
      mockDiscoveryReturn.keyword = "react";
      mockDiscoveryReturn.hasSearched = true;
      mockDiscoveryReturn.repos = [
        { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
      ];
      renderDiscovery();

      await user.click(screen.getByTestId("add-btn-1"));
      await screen.findByRole("alert");
      const rightAfter = mockInvalidateRepos.mock.calls.length;

      await vi.advanceTimersByTimeAsync(BATCH_ADD_TIMEOUT_MS);
      expect(mockInvalidateRepos.mock.calls.length).toBe(rightAfter);
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows the watchlist again once it has caught up with a repo added here", async () => {
    // 剛加入時清單還沒重讀到它，先用本地記下的名字撐著；清單讀到之後就以清單為準——
    // 否則之後別處把它移出清單（同步、逾時後才做完的取消追蹤），這裡還一直顯示已追蹤
    const user = userEvent.setup();
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [
      { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
    ];
    const view = renderDiscovery();
    await user.click(screen.getByTestId("add-btn-1"));
    expect(await screen.findByTestId("in-watchlist-1")).toBeInTheDocument();

    // 清單重讀了、但還沒包含它（請求是加入之前發的）：本地記下的名字要留著
    mockWatchlistRepos = [{ id: 5, full_name: "other/repo" }];
    view.rerender(
      <ToastProvider>
        <Discovery />
      </ToastProvider>
    );
    expect(screen.getByTestId("in-watchlist-1")).toBeInTheDocument();

    mockWatchlistRepos = [
      { id: 5, full_name: "other/repo" },
      { id: 9, full_name: "facebook/react" },
    ];
    view.rerender(
      <ToastProvider>
        <Discovery />
      </ToastProvider>
    );
    expect(screen.getByTestId("in-watchlist-1")).toBeInTheDocument();

    mockWatchlistRepos = [];
    view.rerender(
      <ToastProvider>
        <Discovery />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByTestId("add-btn-1")).toBeInTheDocument());
  });

  it("follows the watchlist even when it caught up before the add response arrived", async () => {
    // 別處的重讀先讀到它、加入的回應才回來：之後的重讀資料相同，React Query 給的是同一個陣列，
    // 只看清單有沒有換的話，這時才記下的名字不會被收掉
    const user = userEvent.setup();
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [
      { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
    ];
    let finishAdd: (value: unknown) => void = () => {};
    mockAddRepo.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishAdd = resolve;
        })
    );
    const view = renderDiscovery();
    await user.click(screen.getByTestId("add-btn-1"));

    mockWatchlistRepos = [{ id: 9, full_name: "facebook/react" }];
    view.rerender(
      <ToastProvider>
        <Discovery />
      </ToastProvider>
    );
    await act(async () => {
      finishAdd({ id: 9 });
    });
    expect(screen.getByTestId("in-watchlist-1")).toBeInTheDocument();

    mockWatchlistRepos = [];
    view.rerender(
      <ToastProvider>
        <Discovery />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByTestId("add-btn-1")).toBeInTheDocument());
  });

  it("shows in-watchlist state for repos already in watchlist", () => {
    mockWatchlistRepos = [{ id: 1, full_name: "facebook/react" }];
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [
      { id: 1, full_name: "facebook/react", owner: "facebook", name: "react" },
    ];
    renderDiscovery();
    expect(screen.getByTestId("in-watchlist-1")).toBeInTheDocument();
  });

  it("knows a search result is tracked by its GitHub id when the local row still has the old name", () => {
    // 本機那一列還叫 facebook/react-old（還沒抓到改名），搜尋結果是 GitHub 上現在的名稱（id 就是 GitHub id）
    mockWatchlistRepos = [{ id: 1, full_name: "facebook/react-old", github_id: 10270250 }];
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [
      { id: 10270250, full_name: "facebook/react", owner: "facebook", name: "react" },
    ];
    renderDiscovery();
    expect(screen.getByTestId("in-watchlist-10270250")).toBeInTheDocument();
  });

  it("gives the feed the GitHub ids of the watchlist", () => {
    mockWatchlistRepos = [
      { id: 5, full_name: "a/old", github_id: 77 },
      { id: 6, full_name: "a/legacy", github_id: null },
    ];
    renderDiscovery();

    expect(screen.getByTestId("feed-github-ids")).toHaveTextContent(/^77$/);
  });

  it("untracks the row with the same GitHub id even when another row holds the card's name", async () => {
    // 卡片停在推薦產生時的舊名 a/old；那個 repo 本機已經叫 a/new，a/old 現在是另一個追蹤中的 repo。
    // 先用名稱找會對那個 repo 取消 star
    mockWatchlistRepos = [
      { id: 5, full_name: "a/new", github_id: 77 },
      { id: 6, full_name: "a/old", github_id: 88 },
    ];
    mockUnstarRepo.mockResolvedValue(undefined);
    renderDiscovery();

    await userEvent.click(screen.getByTestId("stub-feed-unstar-stale"));

    expect(mockUnstarRepo).toHaveBeenCalledWith(5);
    expect(mockUnstarRepo).not.toHaveBeenCalledWith(6);
  });

  it("lets go of a name added here once the watchlist has the repo under its new name", async () => {
    // 從名稱過期的卡片加入：清單重讀後是新名稱，只比名稱的話本地記下的舊名永遠收不掉，
    // 之後它被移出清單（背景同步等），這裡還一直顯示已追蹤
    const user = userEvent.setup();
    mockDiscoveryReturn.keyword = "old";
    mockDiscoveryReturn.hasSearched = true;
    mockDiscoveryReturn.repos = [{ id: 77, full_name: "a/old", owner: "a", name: "old" }];
    const view = renderDiscovery();
    await user.click(screen.getByTestId("add-btn-77"));
    expect(await screen.findByTestId("in-watchlist-77")).toBeInTheDocument();

    mockWatchlistRepos = [{ id: 5, full_name: "a/new", github_id: 77 }];
    view.rerender(
      <ToastProvider>
        <Discovery />
      </ToastProvider>
    );
    mockWatchlistRepos = [];
    view.rerender(
      <ToastProvider>
        <Discovery />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByTestId("add-btn-77")).toBeInTheDocument());
  });

  it("remembers the GitHub id of a repo added from the feed", async () => {
    const user = userEvent.setup();
    const view = renderDiscovery();
    await user.click(screen.getByTestId("stub-feed-add-stale"));
    await waitFor(() => expect(screen.getByTestId("feed-full-names")).toHaveTextContent("a/old"));

    mockWatchlistRepos = [{ id: 5, full_name: "a/new", github_id: 77 }];
    view.rerender(
      <ToastProvider>
        <Discovery />
      </ToastProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("feed-full-names")).toHaveTextContent(/^a\/new$/)
    );
  });

  it("remembers the GitHub id when the feed add says the repo is already tracked", async () => {
    // 背景同步剛把它加進本機、清單還沒重讀：從舊名卡片按加入得到「已經在追蹤清單」。
    // 不記 id 的話，清單裡是新名稱，本地記下的舊名收不掉
    mockAddRepo.mockRejectedValueOnce(
      new ApiError(400, "Repository a/new is already in your watchlist", "ALREADY_TRACKED")
    );
    const user = userEvent.setup();
    const view = renderDiscovery();
    await user.click(screen.getByTestId("stub-feed-add-stale"));
    await waitFor(() => expect(screen.getByTestId("feed-full-names")).toHaveTextContent("a/old"));

    mockWatchlistRepos = [{ id: 5, full_name: "a/new", github_id: 77 }];
    view.rerender(
      <ToastProvider>
        <Discovery />
      </ToastProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("feed-full-names")).toHaveTextContent(/^a\/new$/)
    );
  });

  it("finds the local row by GitHub id when untracking from the feed", async () => {
    mockWatchlistRepos = [{ id: 5, full_name: "a/old", github_id: 77 }];
    mockUnstarRepo.mockResolvedValue(undefined);
    renderDiscovery();

    await userEvent.click(screen.getByTestId("stub-feed-unstar-renamed"));

    expect(mockUnstarRepo).toHaveBeenCalledWith(5);
  });

  it("passes language filter to ActiveFilters", () => {
    mockDiscoveryReturn.filters = { language: "TypeScript" };
    renderDiscovery();
    expect(screen.getByTestId("active-language")).toHaveTextContent("TypeScript");
  });

  it("calls removeKeyword when keyword remove button is clicked", async () => {
    const user = userEvent.setup();
    mockDiscoveryReturn.keyword = "react";
    renderDiscovery();
    await user.click(screen.getByTestId("remove-keyword"));
    expect(mockDiscoveryReturn.removeKeyword).toHaveBeenCalled();
  });

  it("calls removePeriod when period remove button is clicked", async () => {
    const user = userEvent.setup();
    mockDiscoveryReturn.keyword = "react";
    mockDiscoveryReturn.period = "daily";
    renderDiscovery();
    await user.click(screen.getByTestId("remove-period"));
    expect(mockDiscoveryReturn.removePeriod).toHaveBeenCalled();
  });

  it("calls removeLanguage when language remove button is clicked", async () => {
    const user = userEvent.setup();
    mockDiscoveryReturn.filters = { language: "Python" };
    renderDiscovery();
    await user.click(screen.getByTestId("remove-language"));
    expect(mockDiscoveryReturn.removeLanguage).toHaveBeenCalled();
  });

  describe("keyboard shortcut: /", () => {
    it("focuses search input when / key is pressed", () => {
      renderDiscovery();
      const searchInput = screen.getByTestId("search-bar");
      expect(document.activeElement).not.toBe(searchInput);

      fireEvent.keyDown(document, { key: "/" });
      expect(document.activeElement).toBe(searchInput);
    });

    it("does not steal focus when / is typed inside another input", () => {
      // guard 的意義：在別的輸入框打「/」（例如打路徑）不能被搶去搜尋框。
      // 必須用「另一個」input 測——按在搜尋框自己身上時 focus() 是 no-op，測不到 guard。
      render(
        <ToastProvider>
          <input data-testid="other-input" />
          <Discovery />
        </ToastProvider>
      );
      const otherInput = screen.getByTestId("other-input");
      const searchInput = screen.getByTestId("search-bar");
      otherInput.focus();

      fireEvent.keyDown(otherInput, { key: "/" });

      expect(document.activeElement).toBe(otherInput);
      expect(document.activeElement).not.toBe(searchInput);
    });

    it("does not focus search when modifier key is held", () => {
      renderDiscovery();
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
      renderDiscovery();

      fireEvent.click(screen.getByTestId("stub-feed-unstar"));

      await waitFor(() => expect(mockUnstarRepo).toHaveBeenCalledWith(7));
      expect(mockInvalidateRepos).toHaveBeenCalled();
      expect(mockHandleRefreshAll).not.toHaveBeenCalled();
    });

    it("says why adding from the feed failed", async () => {
      mockWatchlistRepos = [];
      mockAddRepo.mockRejectedValueOnce(new ApiError(502, "Upstream service unreachable"));
      renderDiscovery();

      fireEvent.click(screen.getByTestId("stub-feed-add"));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Not added to your watchlist. GitHub returned an error or couldn't be reached. Try again later."
      );
    });

    it("treats already-tracked as done when adding from the feed", async () => {
      mockWatchlistRepos = [];
      mockAddRepo.mockRejectedValueOnce(
        new ApiError(400, "Repository a/one is already in your watchlist", "ALREADY_TRACKED")
      );
      renderDiscovery();

      fireEvent.click(screen.getByTestId("stub-feed-add"));

      await waitFor(() =>
        expect(document.querySelector(".toast-info")).toHaveTextContent(
          "Already on your watchlist."
        )
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("says why unstarring from the feed failed", async () => {
      mockWatchlistRepos = [{ id: 7, full_name: "a/one" }];
      mockUnstarRepo.mockRejectedValueOnce(new ApiError(502, "Upstream service unreachable"));
      renderDiscovery();

      fireEvent.click(screen.getByTestId("stub-feed-unstar"));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Not removed from your watchlist. GitHub returned an error or couldn't be reached. Try again later."
      );
      expect(mockInvalidateRepos).toHaveBeenCalled();
    });

    it("says it is already off the watchlist when the local row is gone", async () => {
      // 不帶 GITHUB_NOT_FOUND 的 404＝本機已經沒有這一列（連按兩次、或背景同步先封存了）：
      // 它已經不在追蹤清單，說「沒有取消追蹤、再試一次」剛好相反
      mockWatchlistRepos = [{ id: 7, full_name: "a/one" }];
      mockUnstarRepo.mockRejectedValueOnce(new ApiError(404, "Repository not found"));
      renderDiscovery();

      fireEvent.click(screen.getByTestId("stub-feed-unstar"));

      await waitFor(() =>
        expect(document.querySelector(".toast-info")).toHaveTextContent(
          "Already off your watchlist."
        )
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(mockInvalidateRepos).toHaveBeenCalled();
    });

    it("says GitHub can't find the repository when GitHub is the one returning 404", async () => {
      mockWatchlistRepos = [{ id: 7, full_name: "a/one" }];
      mockUnstarRepo.mockRejectedValueOnce(
        new ApiError(404, "Resource not found: DELETE star a/one", "GITHUB_NOT_FOUND")
      );
      renderDiscovery();

      fireEvent.click(screen.getByTestId("stub-feed-unstar"));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Not removed from your watchlist. GitHub can't find this repository — it may have been deleted, renamed or made private."
      );
    });

    it("keeps rereading the watchlist for a while after an unstar times out", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        mockWatchlistRepos = [{ id: 7, full_name: "a/one" }];
        mockUnstarRepo.mockRejectedValueOnce(new ApiError(0, "Request timed out"));
        renderDiscovery();

        fireEvent.click(screen.getByTestId("stub-feed-unstar"));
        expect(await screen.findByRole("alert")).toHaveTextContent(
          "No response yet, so it's unclear whether it was removed. Your watchlist will update on its own over the next few minutes."
        );
        const rightAfter = mockInvalidateRepos.mock.calls.length;

        await vi.advanceTimersByTimeAsync(BATCH_ADD_FOLLOWUP_INTERVAL_MS);
        expect(mockInvalidateRepos.mock.calls.length).toBe(rightAfter + 1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("asks to try again when the repo to unstar is not in the loaded watchlist yet", async () => {
      // 剛加入、追蹤清單還沒重讀到它的那一小段時間：查不到本機 id，什麼都沒送出
      mockWatchlistRepos = [];
      renderDiscovery();

      fireEvent.click(screen.getByTestId("stub-feed-unstar"));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Not removed from your watchlist. Try again."
      );
      expect(mockUnstarRepo).not.toHaveBeenCalled();
    });

    it("adding invalidates the list instead of refetching every repo", async () => {
      mockWatchlistRepos = [];
      mockAddRepo.mockResolvedValue({ id: 8 });
      renderDiscovery();

      fireEvent.click(screen.getByTestId("stub-feed-add"));

      await waitFor(() => expect(mockAddRepo).toHaveBeenCalled());
      expect(mockInvalidateRepos).toHaveBeenCalled();
      expect(mockHandleRefreshAll).not.toHaveBeenCalled();
    });
  });
});
