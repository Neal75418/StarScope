/**
 * Repo 卡片元件，顯示 repo 資訊、訊號與情境徽章。
 */

import { useState, useCallback, memo, useMemo } from "react";
import { ContextBadge, EarlySignal, RepoWithSignals } from "../api/client";
import { useRepoCardData } from "../hooks/useRepoCardData";
import { RepoCardHeader, RepoCardStats, RepoCardContent, RepoCardPanels } from "./repo-card";

interface RepoCardHandlers {
  onFetch: (id: number) => void;
  onRemove: (id: number) => void;
}

interface RepoCardPreloadedData {
  /** 由父層批次預載的 badges，避免每張卡個別請求 */
  badges?: ContextBadge[];
  /** 由父層批次預載的 signals，避免每張卡個別請求 */
  signals?: EarlySignal[];
}

interface RepoCardChartState {
  /** 外部控制圖表展開狀態（用於虛擬滾動動態行高） */
  expanded?: boolean;
  /** 外部控制圖表切換回調（接受 repoId 以避免 inline arrow 破壞 memo） */
  onToggle?: (repoId: number) => void;
}

interface RepoCardCategoryContext {
  selectedId?: number | null;
  onRemoveFromCategory?: (categoryId: number, repoId: number) => void;
}

interface RepoCardProps {
  repo: RepoWithSignals;
  isLoading?: boolean;
  handlers: RepoCardHandlers;
  preloadedData?: RepoCardPreloadedData;
  chartState?: RepoCardChartState;
  categoryContext?: RepoCardCategoryContext;
}

export const RepoCard = memo(function RepoCard({
  repo,
  isLoading,
  handlers,
  preloadedData,
  chartState,
  categoryContext,
}: RepoCardProps) {
  const { badges, badgesLoading, activeSignalCount, refreshContext, isRefreshingContext } =
    useRepoCardData(repo.id, preloadedData);
  // 圖表狀態：外部控制優先（虛擬滾動場景），否則使用內部狀態
  const [internalShowChart, setInternalShowChart] = useState(false);
  const showChart = chartState?.expanded ?? internalShowChart;
  const [showSimilar, setShowSimilar] = useState(false);

  // Memoize handler 以避免 memoized 子元件不必要的 re-render
  const handleToggleChart = useCallback(() => {
    if (chartState?.onToggle) {
      chartState.onToggle(repo.id);
    } else {
      setInternalShowChart((prev) => !prev);
    }
  }, [chartState, repo.id]);
  const handleToggleSimilar = useCallback(() => setShowSimilar((prev) => !prev), []);
  const handleFetch = useCallback(() => handlers.onFetch(repo.id), [handlers.onFetch, repo.id]);
  const handleRemove = useCallback(() => handlers.onRemove(repo.id), [handlers.onRemove, repo.id]);
  const handleRemoveFromCategory = useCallback(
    () =>
      categoryContext?.selectedId &&
      categoryContext.onRemoveFromCategory?.(categoryContext.selectedId, repo.id),
    [categoryContext, repo.id]
  );
  const handleCloseSimilar = useCallback(() => setShowSimilar(false), []);
  const stableOnRemoveFromCategory = useMemo(
    () =>
      categoryContext?.selectedId && categoryContext.onRemoveFromCategory
        ? handleRemoveFromCategory
        : undefined,
    [categoryContext?.selectedId, categoryContext?.onRemoveFromCategory, handleRemoveFromCategory]
  );

  return (
    <div className="repo-card">
      <RepoCardHeader
        repo={repo}
        showChart={showChart}
        showSimilar={showSimilar}
        isLoading={isLoading}
        selectedCategoryId={categoryContext?.selectedId}
        activeSignalCount={activeSignalCount}
        onToggleChart={handleToggleChart}
        onToggleSimilar={handleToggleSimilar}
        onFetch={handleFetch}
        onRemove={handleRemove}
        onRemoveFromCategory={stableOnRemoveFromCategory}
      />

      <RepoCardContent
        repoId={repo.id}
        description={repo.description}
        badges={badges}
        badgesLoading={badgesLoading}
        onRefreshContext={refreshContext}
        isRefreshingContext={isRefreshingContext}
      />

      <RepoCardStats repo={repo} />

      <RepoCardPanels
        repoId={repo.id}
        showChart={showChart}
        showSimilar={showSimilar}
        onCloseSimilar={handleCloseSimilar}
      />
    </div>
  );
});
