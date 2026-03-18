/**
 * Discovery 頁面，搜尋與探索 GitHub repo，支援關鍵字＋時間區間＋語言篩選。
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useI18n } from "../i18n";
import { useDiscovery } from "../hooks/useDiscovery";
import { useSearchHistory } from "../hooks/useSearchHistory";
import { useRecentlyViewed, RecentlyViewedRepo } from "../hooks/useRecentlyViewed";
import { useSelectionMode } from "../hooks/useSelectionMode";
import { useViewMode } from "../hooks/useViewMode";
import { useDiscoveryUrl } from "../hooks/useDiscoveryUrl";
import { useOnceEffect } from "../hooks/useOnceEffect";
import { useWatchlistState, useWatchlistActions } from "../contexts/WatchlistContext";
import { useToast } from "../components/Toast";
import { AnimatedPage } from "../components/motion";
import { normalizeRepoName } from "../utils/format";
import { addRepo, DiscoveryRepo } from "../api/client";
import type { PersonalizedRecommendation } from "../api/types";
import {
  DiscoverySearchBar,
  TrendingFilters,
  TrendingPeriod,
  ActiveFilters,
  DiscoveryFilters,
  DiscoveryResults,
  SavedFilters,
  RecommendedForYou,
  QuickPicks,
  RecentlyViewed,
  BatchAddBar,
} from "../components/discovery";

export function Discovery() {
  const { t } = useI18n();
  const toast = useToast();
  const discovery = useDiscovery();
  const {
    setKeyword,
    setPeriod,
    setFilters,
    filters: discoveryFilters,
    reset: resetDiscovery,
  } = discovery;
  const { history, addToHistory, removeFromHistory, clearHistory } = useSearchHistory();
  const { recentRepos, addToRecentlyViewed, clearRecentlyViewed } = useRecentlyViewed();
  const selection = useSelectionMode();
  const { viewMode, setViewMode } = useViewMode();
  const { repos: watchlist } = useWatchlistState();
  const { refreshAll: handleRefreshAll } = useWatchlistActions();

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [addingRepoId, setAddingRepoId] = useState<number | null>(null);
  // 追蹤本地新增的 repo 以即時反映 UI
  const [locallyAdded, setLocallyAdded] = useState<Set<string>>(new Set());

  // URL 同步：篩選條件 ↔ URL hash
  const { hasUrlParams } = useDiscoveryUrl({
    keyword: discovery.keyword,
    period: discovery.period,
    filters: discoveryFilters,
    hasSearched: discovery.hasSearched,
    onRestoreState: discovery.restoreState,
  });

  // Keyboard shortcut: "/" to focus search
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

  // Cold start：掛載時自動載入本週趨勢（URL 有參數時跳過）
  useOnceEffect(() => {
    if (!hasUrlParams) {
      setPeriod("weekly");
    }
  });

  // 建立 watchlist full_name 的 Set 以快速查找（含本地新增的）
  const watchlistFullNames = useMemo(
    () => new Set([...watchlist.map((r) => normalizeRepoName(r.full_name)), ...locallyAdded]),
    [watchlist, locallyAdded]
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
      }
    },
    [t.discovery.trending]
  );

  // 搜尋並記錄歷史（也用於從歷史選擇搜尋）
  const handleSearch = useCallback(
    (keyword: string) => {
      setKeyword(keyword);
      addToHistory(keyword);
    },
    [setKeyword, addToHistory]
  );

  // Quick pick：語言
  const handleQuickLanguage = useCallback(
    (lang: string) => {
      setFilters({ ...discoveryFilters, language: lang });
    },
    [discoveryFilters, setFilters]
  );

  // Quick pick：主題
  const handleQuickTopic = useCallback(
    (topic: string) => {
      setFilters({ ...discoveryFilters, topic });
    },
    [discoveryFilters, setFilters]
  );

  // 清除所有篩選條件
  const handleClearAll = useCallback(() => {
    resetDiscovery();
  }, [resetDiscovery]);

  // 將 repo 加入 watchlist（共用邏輯）
  const doAddToWatchlist = useCallback(
    async (owner: string, name: string, fullName: string, id: number) => {
      setAddingRepoId(id);
      try {
        await addRepo({ owner, name });
        setLocallyAdded((prev) => new Set(prev).add(normalizeRepoName(fullName)));
        void handleRefreshAll();
        toast.success(t.toast.repoAdded);
      } catch {
        toast.error(t.toast.error);
      } finally {
        setAddingRepoId(null);
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

  // 點擊 repo link 時記錄到 recently viewed
  const handleViewRepo = useCallback(
    (repo: DiscoveryRepo) => {
      const viewed: RecentlyViewedRepo = {
        id: repo.id,
        full_name: repo.full_name,
        owner: repo.owner,
        name: repo.name,
        language: repo.language,
        stars: repo.stars,
        owner_avatar_url: repo.owner_avatar_url,
      };
      addToRecentlyViewed(viewed);
    },
    [addToRecentlyViewed]
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
        addingRepoId={addingRepoId}
      />

      <DiscoverySearchBar
        inputRef={searchInputRef}
        onSearch={handleSearch}
        loading={discovery.loading}
        initialQuery={discovery.keyword}
        searchHistory={history}
        onSelectHistory={handleSearch}
        onRemoveHistory={removeFromHistory}
        onClearHistory={clearHistory}
      />

      <div className="discovery-toolbar">
        <TrendingFilters onSelectPeriod={discovery.setPeriod} activePeriod={discovery.period} />
        <SavedFilters
          currentQuery={discovery.keyword}
          currentPeriod={discovery.period}
          currentFilters={discovery.filters}
          onApply={discovery.applySavedFilter}
        />
      </div>

      {!discovery.hasSearched && (
        <QuickPicks onSelectLanguage={handleQuickLanguage} onSelectTopic={handleQuickTopic} />
      )}

      <RecentlyViewed repos={recentRepos} onClear={clearRecentlyViewed} />

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
        onClearAll={handleClearAll}
      />

      <DiscoveryFilters filters={discovery.filters} onFiltersChange={discovery.setFilters} />

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
        addingRepoId={addingRepoId}
        hasSearched={discovery.hasSearched}
        onViewRepo={handleViewRepo}
        isSelectionMode={selection.isActive}
        selectedIds={selection.selectedIds}
        onToggleSelection={selection.toggleSelection}
        onEnterSelectionMode={selection.enter}
        onExitSelectionMode={selection.exit}
        resultsKey={resultsKey}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

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
