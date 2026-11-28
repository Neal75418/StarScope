/**
 * Discovery 頁面，搜尋與探索 GitHub repo，支援關鍵字＋時間區間＋語言篩選。
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { interpolate, useI18n } from "../i18n";
import { useDiscovery } from "../hooks/useDiscovery";
import { useSelectionMode } from "../hooks/useSelectionMode";
import { useViewMode } from "../hooks/useViewMode";
import { useWatchlistState, useWatchlistActions } from "../contexts/WatchlistContext";
import { useToast } from "../components/Toast";
import { AnimatedPage } from "../components/motion";
import { normalizeRepoName } from "../utils/format";
import { describeWriteFailure, isRequestTimeout } from "../utils/writeFailure";
import { keepRefetchingAfterTimeout } from "../lib/react-query";
import { addRepo, unstarRepo, DiscoveryRepo } from "../api/client";
import { ApiError } from "../api/types";
import type { PersonalizedRecommendation, FeedItem as FeedItemType } from "../api/types";
import {
  DiscoverySearchBar,
  TrendingFilters,
  TrendingPeriod,
  ActiveFilters,
  DiscoveryFilters,
  DiscoveryResults,
  RecommendedForYou,
  BatchAddBar,
  ForYouFeed,
} from "../components/discovery";

export function Discovery() {
  const { t } = useI18n();
  const toast = useToast();
  const discovery = useDiscovery();
  const { setKeyword, setPeriod, filters: discoveryFilters, reset: resetDiscovery } = discovery;
  const selection = useSelectionMode();
  const { viewMode, setViewMode } = useViewMode();
  const { repos: watchlist } = useWatchlistState();
  const { invalidateRepos } = useWatchlistActions();

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [addingRepoIds, setAddingRepoIds] = useState<Set<number>>(new Set());
  // 追蹤本地新增的 repo 以即時反映 UI：卡片上的名稱 → GitHub id（不知道時是 null）
  const [locallyAdded, setLocallyAdded] = useState<Map<string, number | null>>(new Map());
  const rememberAdded = useCallback((fullName: string, githubId: number | null) => {
    setLocallyAdded((prev) => new Map(prev).set(normalizeRepoName(fullName), githubId));
  }, []);
  // 使用者是否曾主動點擊 Trending period 按鈕（決定是否切到搜尋結果視圖）
  const [userBrowsedTrending, setUserBrowsedTrending] = useState(false);

  // 鍵盤快捷鍵：「/」聚焦搜尋框
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 建立 watchlist full_name 的 Set 以快速查找（含本地新增的）
  const watchlistFullNames = useMemo(
    () =>
      new Set([...watchlist.map((r) => normalizeRepoName(r.full_name)), ...locallyAdded.keys()]),
    [watchlist, locallyAdded]
  );

  // 本地記下的名字只撐到追蹤清單重讀到它為止，之後以清單為準：否則別處把它移出清單之後
  // （背景同步、逾時後才做完的取消追蹤），這裡還一直顯示已追蹤，再按取消又查不到 id。
  // 記下名字時也要比一次：清單可能在加入的回應回來之前就讀到它了，之後的重讀是同一個陣列。
  // 名稱或 GitHub id 有一個對上就算讀到了：從名稱過期的卡片加入時，清單裡是新名稱，只比名稱永遠收不掉
  useEffect(() => {
    const caughtUpNames = new Set(watchlist.map((r) => normalizeRepoName(r.full_name)));
    const caughtUpIds = new Set(watchlist.map((r) => r.github_id));
    setLocallyAdded((prev) => {
      const stillAhead = [...prev].filter(
        ([name, githubId]) =>
          !caughtUpNames.has(name) && (githubId == null || !caughtUpIds.has(githubId))
      );
      return stillAhead.length === prev.size ? prev : new Map(stillAhead);
    });
  }, [watchlist, locallyAdded]);

  // GitHub id：名稱會對不上。搜尋結果是 GitHub 上現在的名稱，本機那一列可能還沒抓到改名；
  // 每日的「為你推薦」卡片停在推薦產生時的名稱，之後改名的話本機那一列反而是新名稱。
  // 只比名稱會把已追蹤的當成沒追蹤、取消追蹤時也找不到它
  const watchlistGithubIds = useMemo(
    () => new Set(watchlist.flatMap((r) => (r.github_id == null ? [] : [r.github_id]))),
    [watchlist]
  );
  const watchlistIdByGithubId = useMemo(
    () =>
      new Map(
        watchlist.flatMap((r) => (r.github_id == null ? [] : [[r.github_id, r.id] as const]))
      ),
    [watchlist]
  );

  // full_name -> 本機 repo id。取消追蹤要打本機 id：先用 GitHub id 找（watchlistIdByGithubId），找不到才用名稱。
  // 剛加入但 watchlist 尚未重取時兩個都查不到，那時取消會被略過——下一次重取就有了。
  const watchlistIdByName = useMemo(
    () => new Map(watchlist.map((r) => [normalizeRepoName(r.full_name), r.id])),
    [watchlist]
  );

  // 建立 watchlist 信號 map：full_name -> { velocity, trend }
  const watchlistSignalMap = useMemo(
    () =>
      new Map(
        watchlist.map((r) => [
          normalizeRepoName(r.full_name),
          { velocity: r.velocity, trend: r.trend },
        ])
      ),
    [watchlist]
  );

  // 取得時間區間的顯示文字
  const getPeriodLabel = useCallback(
    (period: TrendingPeriod): string => {
      switch (period) {
        case "daily":
          return t.discovery.trending.today;
        case "weekly":
          return t.discovery.trending.thisWeek;
        case "monthly":
          return t.discovery.trending.thisMonth;
        case "yearly":
          return t.discovery.trending.thisYear;
      }
    },
    [t.discovery.trending]
  );

  const handleSearch = useCallback(
    (keyword: string) => {
      setKeyword(keyword);
    },
    [setKeyword]
  );

  // 使用者主動點擊 Trending period 按鈕：視為 active search，切到 DiscoveryResults
  const handleSelectPeriod = useCallback(
    (period: TrendingPeriod) => {
      setUserBrowsedTrending(true);
      setPeriod(period);
    },
    [setPeriod]
  );

  // Clear All／Reset：回到 For You feed 預設畫面
  const handleResetDiscovery = useCallback(() => {
    setUserBrowsedTrending(false);
    resetDiscovery();
  }, [resetDiscovery]);

  // 加入失敗的共同處理。回傳「結果是不是使用者要的」：後端說已經在追蹤清單時不算失敗
  const reportAddFailure = useCallback(
    (err: unknown, fullName: string, githubId: number | null): boolean => {
      // 有些失敗代表清單其實已經變了（別處加過、逾時後伺服器做完了）：一律重讀
      invalidateRepos();
      if (err instanceof ApiError && err.code === "ALREADY_TRACKED") {
        rememberAdded(fullName, githubId);
        toast.info(t.discovery.addFailed.alreadyTracked);
        return true;
      }
      // 逾時的提示說清單會自己更新：伺服器可能晚一點才做完，接下來一陣子定期重讀
      if (isRequestTimeout(err)) keepRefetchingAfterTimeout(invalidateRepos);
      toast.error(describeWriteFailure(err, t, t.discovery.addFailed));
      return false;
    },
    [invalidateRepos, toast, t, rememberAdded]
  );

  // 將 repo 加入 watchlist（共用邏輯）。githubId 是卡片上的 GitHub id（推薦區的是本機 id，傳 null）
  const doAddToWatchlist = useCallback(
    async (owner: string, name: string, fullName: string, id: number, githubId: number | null) => {
      setAddingRepoIds((prev) => new Set(prev).add(id));
      try {
        const added = await addRepo({ owner, name });
        rememberAdded(fullName, added?.github_id ?? githubId);
        // 同 handleFeedAdd：只重讀本機清單，不重抓每一個 repo
        invalidateRepos();
        toast.success(t.toast.repoAdded);
      } catch (err) {
        reportAddFailure(err, fullName, githubId);
      } finally {
        setAddingRepoIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [toast, t.toast.repoAdded, invalidateRepos, reportAddFailure, rememberAdded]
  );

  // 搜尋結果加入 watchlist
  const handleAddToWatchlist = useCallback(
    async (repo: DiscoveryRepo) => {
      await doAddToWatchlist(repo.owner, repo.name, repo.full_name, repo.id, repo.id);
    },
    [doAddToWatchlist]
  );

  // 推薦結果加入 watchlist
  const handleRecAddToWatchlist = useCallback(
    async (rec: PersonalizedRecommendation) => {
      const [owner, name] = rec.full_name.split("/");
      if (owner && name) {
        // 推薦區的名稱來自本機同一張表，跟追蹤清單一致，用名稱就收得掉
        await doAddToWatchlist(owner, name, rec.full_name, rec.repo_id, null);
      }
    },
    [doAddToWatchlist]
  );

  // For You feed 加入 watchlist；回傳是否成功，供呼叫端決定是否送出 starred feedback
  const handleFeedAdd = useCallback(
    async (item: FeedItemType): Promise<boolean> => {
      try {
        const added = await addRepo({ owner: item.owner, name: item.name });
        rememberAdded(item.full_name, added?.github_id ?? item.github_id);
        // 只讓清單重讀本機，不要 refreshAll——那支會對每個追蹤中的 repo 各打一次
        // GitHub，追蹤上百個時畫面要等它全部跑完才更新。新增的初始快照 POST /repos
        // 已經建好了，沒有東西需要重抓。
        invalidateRepos();
        toast.success(t.toast.repoAdded);
        return true;
      } catch (err) {
        return reportAddFailure(err, item.full_name, item.github_id);
      }
    },
    [toast, t.toast.repoAdded, invalidateRepos, reportAddFailure, rememberAdded]
  );

  const handleFeedUnstar = useCallback(
    async (item: FeedItemType): Promise<boolean> => {
      const key = normalizeRepoName(item.full_name);
      // 先用 GitHub id：卡片上的舊名可能已經是另一個追蹤中的 repo，先用名稱找會對它取消 star
      const repoId = watchlistIdByGithubId.get(item.github_id) ?? watchlistIdByName.get(key);
      if (repoId === undefined) {
        // 通常是「剛加入、watchlist 還沒重取」的短暫空窗：請求沒有送出，重取之後再按就行
        toast.error(
          interpolate(t.failure.withCause, {
            outcome: t.discovery.unstarFailed.notDone,
            cause: t.failure.retry,
          })
        );
        return false;
      }
      try {
        await unstarRepo(repoId);
        setLocallyAdded((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        // 同上：本機那一列已經改好，重抓整份清單只是讓使用者多等
        invalidateRepos();
        toast.success(t.toast.repoRemoved);
        return true;
      } catch (err) {
        invalidateRepos();
        // 不帶 GITHUB_NOT_FOUND 的 404＝本機已經沒有這一列（連按兩次、或背景同步先封存了）：
        // 它已經不在追蹤清單，結果就是使用者要的
        if (err instanceof ApiError && err.status === 404 && err.code !== "GITHUB_NOT_FOUND") {
          toast.info(t.discovery.unstarFailed.alreadyRemoved);
          return true;
        }
        if (isRequestTimeout(err)) keepRefetchingAfterTimeout(invalidateRepos);
        toast.error(describeWriteFailure(err, t, t.discovery.unstarFailed));
        return false;
      }
    },
    [watchlistIdByGithubId, watchlistIdByName, toast, t, invalidateRepos]
  );

  // 是否「仍在」瀏覽使用者主動點選的 trending：以 period 目前是否還有值作為衍生條件，
  // 而非單純依賴 userBrowsedTrending 這個持久旗標——這樣無論是按 Clear all、還是用
  // ActiveFilters 個別的「×」移除 period chip（discovery.removePeriod），只要 period
  // 被清空，這裡就會自動跟著變回 false，不會有旗標與實際條件脫鉤、卡在 DiscoveryResults 回不去 feed 的問題。
  const isBrowsingTrending = userBrowsedTrending && Boolean(discovery.period);

  // 是否有搜尋關鍵字、篩選條件、或使用者主動瀏覽 trending：決定顯示搜尋結果還是 For You feed
  const hasActiveSearch = useMemo(
    () =>
      discovery.keyword.trim() !== "" ||
      isBrowsingTrending ||
      Boolean(
        discoveryFilters.language ||
        discoveryFilters.topic ||
        discoveryFilters.minStars ||
        discoveryFilters.maxStars ||
        discoveryFilters.license ||
        discoveryFilters.hideArchived
      ),
    [discovery.keyword, discoveryFilters, isBrowsingTrending]
  );

  // Batch add：收集已選 repo 的 { owner, name }
  const selectedReposForBatch = useMemo(
    () =>
      discovery.repos
        .filter((r) => selection.selectedIds.has(r.id))
        .map((r) => ({ owner: r.owner, name: r.name })),
    [discovery.repos, selection.selectedIds]
  );

  // 排序/篩選切換時的動畫 key — loadMore 不會改變 key
  const resultsKey = useMemo(
    () =>
      JSON.stringify({
        q: discovery.keyword,
        p: discovery.period,
        f: discoveryFilters,
      }),
    [discovery.keyword, discovery.period, discoveryFilters]
  );

  return (
    <AnimatedPage className="page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.discovery.title}</h1>
        <p className="subtitle">{t.discovery.subtitle}</p>
      </header>

      <RecommendedForYou
        watchlistFullNames={watchlistFullNames}
        onAddToWatchlist={handleRecAddToWatchlist}
        addingRepoIds={addingRepoIds}
      />

      <DiscoverySearchBar
        inputRef={searchInputRef}
        onSearch={handleSearch}
        loading={discovery.loading}
        initialQuery={discovery.keyword}
      />

      <div className="discovery-toolbar">
        <TrendingFilters onSelectPeriod={handleSelectPeriod} activePeriod={discovery.period} />
      </div>

      {/* 僅在搜尋模式顯示：feed 模式下這些條件對 feed 無效，顯示出來會誤導成「feed 有被篩選」 */}
      {hasActiveSearch && (
        <ActiveFilters
          keyword={discovery.keyword || undefined}
          period={discovery.period ? getPeriodLabel(discovery.period) : undefined}
          language={discovery.filters.language}
          topic={discovery.filters.topic}
          minStars={discovery.filters.minStars}
          maxStars={discovery.filters.maxStars}
          license={discovery.filters.license}
          hideArchived={discovery.filters.hideArchived}
          onRemoveKeyword={discovery.removeKeyword}
          onRemovePeriod={discovery.removePeriod}
          onRemoveLanguage={discovery.removeLanguage}
          onRemoveTopic={discovery.removeTopic}
          onRemoveMinStars={discovery.removeMinStars}
          onRemoveMaxStars={discovery.removeMaxStars}
          onRemoveLicense={discovery.removeLicense}
          onRemoveHideArchived={discovery.removeHideArchived}
          onClearAll={handleResetDiscovery}
        />
      )}

      <DiscoveryFilters filters={discovery.filters} onFiltersChange={discovery.setFilters} />

      {hasActiveSearch ? (
        <DiscoveryResults
          repos={discovery.repos}
          totalCount={discovery.totalCount}
          hasMore={discovery.hasMore}
          loading={discovery.loading}
          error={discovery.error}
          watchlistFullNames={watchlistFullNames}
          watchlistGithubIds={watchlistGithubIds}
          watchlistSignalMap={watchlistSignalMap}
          onAddToWatchlist={handleAddToWatchlist}
          onLoadMore={discovery.loadMore}
          addingRepoIds={addingRepoIds}
          hasSearched={discovery.hasSearched}
          isSelectionMode={selection.isActive}
          selectedIds={selection.selectedIds}
          onToggleSelection={selection.toggleSelection}
          onEnterSelectionMode={selection.enter}
          onExitSelectionMode={selection.exit}
          resultsKey={resultsKey}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      ) : (
        <ForYouFeed
          onAddToWatchlist={handleFeedAdd}
          onUnstar={handleFeedUnstar}
          watchlistFullNames={watchlistFullNames}
          watchlistGithubIds={watchlistGithubIds}
        />
      )}

      {selection.isActive && (
        <BatchAddBar
          selectedRepos={selectedReposForBatch}
          selectedCount={selection.selectedCount}
          onDone={selection.exit}
        />
      )}
    </AnimatedPage>
  );
}
