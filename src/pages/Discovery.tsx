/**
 * Discovery 頁面，搜尋與探索 GitHub repo，支援關鍵字＋時間區間＋語言篩選。
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useI18n } from "../i18n";
import { useDiscovery } from "../hooks/useDiscovery";
import { useSelectionMode } from "../hooks/useSelectionMode";
import { useViewMode } from "../hooks/useViewMode";
import { useWatchlistState, useWatchlistActions } from "../contexts/WatchlistContext";
import { useToast } from "../components/Toast";
import { AnimatedPage } from "../components/motion";
import { normalizeRepoName } from "../utils/format";
import { addRepo, unstarRepo, DiscoveryRepo } from "../api/client";
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
  const { refreshAll: handleRefreshAll } = useWatchlistActions();

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [addingRepoIds, setAddingRepoIds] = useState<Set<number>>(new Set());
  // 追蹤本地新增的 repo 以即時反映 UI
  const [locallyAdded, setLocallyAdded] = useState<Set<string>>(new Set());
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
    () => new Set([...watchlist.map((r) => normalizeRepoName(r.full_name)), ...locallyAdded]),
    [watchlist, locallyAdded]
  );

  // full_name -> 本機 repo id。取消追蹤要打本機 id，而 feed item 只有 full_name。
  // 剛加入但 watchlist 尚未重取時查不到 id，那時取消會被略過——下一次重取就有了。
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

  // 將 repo 加入 watchlist（共用邏輯）
  const doAddToWatchlist = useCallback(
    async (owner: string, name: string, fullName: string, id: number) => {
      setAddingRepoIds((prev) => new Set(prev).add(id));
      try {
        await addRepo({ owner, name });
        setLocallyAdded((prev) => new Set(prev).add(normalizeRepoName(fullName)));
        void handleRefreshAll();
        toast.success(t.toast.repoAdded);
      } catch {
        toast.error(t.toast.error);
      } finally {
        setAddingRepoIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [toast, t.toast.repoAdded, t.toast.error, handleRefreshAll]
  );

  // 搜尋結果加入 watchlist
  const handleAddToWatchlist = useCallback(
    async (repo: DiscoveryRepo) => {
      await doAddToWatchlist(repo.owner, repo.name, repo.full_name, repo.id);
    },
    [doAddToWatchlist]
  );

  // 推薦結果加入 watchlist
  const handleRecAddToWatchlist = useCallback(
    async (rec: PersonalizedRecommendation) => {
      const [owner, name] = rec.full_name.split("/");
      if (owner && name) {
        await doAddToWatchlist(owner, name, rec.full_name, rec.repo_id);
      }
    },
    [doAddToWatchlist]
  );

  // For You feed 加入 watchlist；回傳是否成功，供呼叫端決定是否送出 starred feedback
  const handleFeedAdd = useCallback(
    async (item: FeedItemType): Promise<boolean> => {
      try {
        await addRepo({ owner: item.owner, name: item.name });
        setLocallyAdded((prev) => new Set(prev).add(normalizeRepoName(item.full_name)));
        void handleRefreshAll();
        toast.success(t.toast.repoAdded);
        return true;
      } catch {
        toast.error(t.toast.error);
        return false;
      }
    },
    [toast, t.toast.repoAdded, t.toast.error, handleRefreshAll]
  );

  const handleFeedUnstar = useCallback(
    async (item: FeedItemType): Promise<boolean> => {
      const key = normalizeRepoName(item.full_name);
      const repoId = watchlistIdByName.get(key);
      if (repoId === undefined) {
        // 只可能發生在「剛加入、watchlist 還沒重取」的短暫空窗
        toast.error(t.toast.error);
        return false;
      }
      try {
        await unstarRepo(repoId);
        setLocallyAdded((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        void handleRefreshAll();
        toast.success(t.toast.repoRemoved);
        return true;
      } catch {
        toast.error(t.toast.error);
        return false;
      }
    },
    [watchlistIdByName, toast, t.toast.repoRemoved, t.toast.error, handleRefreshAll]
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
