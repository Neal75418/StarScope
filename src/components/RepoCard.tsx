/**
 * Repo 卡片元件，顯示 repo 資訊、訊號與情境徽章。
 */

import { useState, useCallback, memo, useMemo } from "react";
import { ContextBadge, EarlySignal, RepoWithSignals } from "../api/client";
import { useRepoCardData } from "../hooks/useRepoCardData";
import { RepoCardHeader, RepoCardStats, RepoCardContent, RepoCardPanels } from "./repo-card";

interface RepoCardProps {
  repo: RepoWithSignals;
  onFetch: (id: number) => void;
  onRemove: (id: number) => void;
  isLoading?: boolean;
  selectedCategoryId?: number | null;
  onRemoveFromCategory?: (categoryId: number, repoId: number) => void;
  /** 由父層批次預載的 badges，避免每張卡個別請求 */
  preloadedBadges?: ContextBadge[];
  /** 由父層批次預載的 signals，避免每張卡個別請求 */
  preloadedSignals?: EarlySignal[];
  /** 外部控制圖表展開狀態（用於虛擬滾動動態行高） */
  chartExpanded?: boolean;
  /** 外部控制圖表切換回調 */
  onChartToggle?: () => void;
}

export const RepoCard = memo(function RepoCard({
  repo,
  onFetch,
  onRemove,
  isLoading,
  selectedCategoryId,
  onRemoveFromCategory,
  preloadedBadges,
  preloadedSignals,
  chartExpanded,
  onChartToggle,
}: RepoCardProps) {
  const preloaded = useMemo(
    () =>
      preloadedBadges || preloadedSignals
        ? { badges: preloadedBadges, signals: preloadedSignals }
        : undefined,
    [preloadedBadges, preloadedSignals]
  );
  const { badges, badgesLoading, activeSignalCount, refreshContext, isRefreshingContext } =
    useRepoCardData(repo.id, preloaded);
  // 圖表狀態：外部控制優先（虛擬滾動場景），否則使用內部狀態
  const [internalShowChart, setInternalShowChart] = useState(false);
  const showChart = chartExpanded ?? internalShowChart;
  const [showSimilar, setShowSimilar] = useState(false);

  // Memoize handler 以避免 memoized 子元件不必要的 re-render
  const handleToggleChart = useCallback(() => {
    if (onChartToggle) {
      onChartToggle();
    } else {
      setInternalShowChart((prev) => !prev);
    }
  }, [onChartToggle]);
  const handleToggleSimilar = useCallback(() => setShowSimilar((prev) => !prev), []);
  const handleFetch = useCallback(() => onFetch(repo.id), [onFetch, repo.id]);
  const handleRemove = useCallback(() => onRemove(repo.id), [onRemove, repo.id]);
  const handleRemoveFromCategory = useCallback(
    () => selectedCategoryId && onRemoveFromCategory?.(selectedCategoryId, repo.id),
    [selectedCategoryId, onRemoveFromCategory, repo.id]
  );
  const handleCloseSimilar = useCallback(() => setShowSimilar(false), []);
  const stableOnRemoveFromCategory = useMemo(
    () => (selectedCategoryId && onRemoveFromCategory ? handleRemoveFromCategory : undefined),
    [selectedCategoryId, onRemoveFromCategory, handleRemoveFromCategory]
  );

  return (
    <div className="repo-card">
      <RepoCardHeader
        repo={repo}
        showChart={showChart}
        showSimilar={showSimilar}
        isLoading={isLoading}
        selectedCategoryId={selectedCategoryId}
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
