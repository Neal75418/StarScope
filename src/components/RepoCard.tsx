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
  const [showChart, setShowChart] = useState(false);
  const [showSimilar, setShowSimilar] = useState(false);

  // Memoize handler 以避免 memoized 子元件不必要的 re-render
  const handleToggleChart = useCallback(() => setShowChart((prev) => !prev), []);
  const handleToggleSimilar = useCallback(() => setShowSimilar((prev) => !prev), []);
  const handleFetch = useCallback(() => onFetch(repo.id), [onFetch, repo.id]);
  const handleRemove = useCallback(() => onRemove(repo.id), [onRemove, repo.id]);
  const handleRemoveFromCategory = useCallback(
    () => selectedCategoryId && onRemoveFromCategory?.(selectedCategoryId, repo.id),
    [selectedCategoryId, onRemoveFromCategory, repo.id]
  );
  const handleCloseSimilar = useCallback(() => setShowSimilar(false), []);

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
        onRemoveFromCategory={
          selectedCategoryId && onRemoveFromCategory ? handleRemoveFromCategory : undefined
        }
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
