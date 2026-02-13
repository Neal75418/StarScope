/**
 * Discovery 頁面，搜尋與探索 GitHub repo，支援關鍵字＋時間區間＋語言篩選。
 */

import { useState, useCallback, useMemo } from "react";
import { useI18n } from "../i18n";
import { useDiscovery } from "../hooks/useDiscovery";
import { useWatchlistState, useWatchlistActions } from "../contexts/WatchlistContext";
import { useToast } from "../components/Toast";
import { AnimatedPage } from "../components/motion";
import { addRepo, DiscoveryRepo } from "../api/client";
import {
  DiscoverySearchBar,
  TrendingFilters,
  TrendingPeriod,
  ActiveFilters,
  DiscoveryFilters,
  DiscoveryResults,
  SavedFilters,
} from "../components/discovery";

export function Discovery() {
  const { t } = useI18n();
  const toast = useToast();
  const discovery = useDiscovery();
  const { repos: watchlist } = useWatchlistState();
  const { refreshAll: handleRefreshAll } = useWatchlistActions();

  const [addingRepoId, setAddingRepoId] = useState<number | null>(null);
  // 追蹤本地新增的 repo 以即時反映 UI
  const [locallyAdded, setLocallyAdded] = useState<Set<string>>(new Set());

  // 建立 watchlist full_name 的 Set 以快速查找（含本地新增的）
  const watchlistFullNames = useMemo(() => {
    const names = new Set(watchlist.map((r) => r.full_name.toLowerCase()));
    locallyAdded.forEach((name) => names.add(name));
    return names;
  }, [watchlist, locallyAdded]);

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

  // 清除所有篩選條件
  const handleClearAll = useCallback(() => {
    discovery.reset();
  }, [discovery]);

  // 將 repo 加入 watchlist
  const handleAddToWatchlist = useCallback(
    async (repo: DiscoveryRepo) => {
      setAddingRepoId(repo.id);
      try {
        await addRepo({ owner: repo.owner, name: repo.name });
        // 立即更新本地狀態以即時反映 UI
        setLocallyAdded((prev) => new Set(prev).add(repo.full_name.toLowerCase()));
        // 背景重新整理 watchlist 以同步後端資料
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

  return (
    <AnimatedPage className="page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.discovery.title}</h1>
        <p className="subtitle">{t.discovery.subtitle}</p>
      </header>

      <DiscoverySearchBar
        onSearch={discovery.setKeyword}
        loading={discovery.loading}
        initialQuery={discovery.keyword}
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

      <ActiveFilters
        keyword={discovery.keyword || undefined}
        period={discovery.period ? getPeriodLabel(discovery.period) : undefined}
        language={discovery.filters.language}
        onRemoveKeyword={discovery.removeKeyword}
        onRemovePeriod={discovery.removePeriod}
        onRemoveLanguage={discovery.removeLanguage}
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
        onAddToWatchlist={handleAddToWatchlist}
        onLoadMore={discovery.loadMore}
        addingRepoId={addingRepoId}
        hasSearched={discovery.hasSearched}
      />
    </AnimatedPage>
  );
}
