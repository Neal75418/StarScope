/**
 * Repository card component displaying repo info, signals, and context badges.
 * Simplified version focusing on core metrics.
 */

import { useState } from "react";
import { RepoWithSignals } from "../api/client";
import { useRepoCardData } from "../hooks/useRepoCardData";
import { RepoCardHeader, RepoCardStats, RepoCardContent, RepoCardPanels } from "./repo-card";

interface RepoCardProps {
  repo: RepoWithSignals;
  onFetch: (id: number) => void;
  onRemove: (id: number) => void;
  isLoading?: boolean;
  selectedCategoryId?: number | null;
  onRemoveFromCategory?: (categoryId: number, repoId: number) => void;
}

export function RepoCard({
  repo,
  onFetch,
  onRemove,
  isLoading,
  selectedCategoryId,
  onRemoveFromCategory,
}: RepoCardProps) {
  const { badges, badgesLoading, activeSignalCount, refreshContext, isRefreshingContext } =
    useRepoCardData(repo.id);
  const [showChart, setShowChart] = useState(false);
  const [showSimilar, setShowSimilar] = useState(false);

  return (
    <div className="repo-card">
      <RepoCardHeader
        repo={repo}
        showChart={showChart}
        showSimilar={showSimilar}
        isLoading={isLoading}
        selectedCategoryId={selectedCategoryId}
        activeSignalCount={activeSignalCount}
        onToggleChart={() => setShowChart(!showChart)}
        onToggleSimilar={() => setShowSimilar(!showSimilar)}
        onFetch={() => onFetch(repo.id)}
        onRemove={() => onRemove(repo.id)}
        onRemoveFromCategory={
          selectedCategoryId && onRemoveFromCategory
            ? () => onRemoveFromCategory(selectedCategoryId, repo.id)
            : undefined
        }
      />

      <RepoCardContent
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
        onCloseSimilar={() => setShowSimilar(false)}
      />
    </div>
  );
}
