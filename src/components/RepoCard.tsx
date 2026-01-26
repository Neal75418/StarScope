/**
 * Repository card component displaying repo info, signals, and context badges.
 */

import { useState, useCallback } from "react";
import { RepoWithSignals, HealthScoreResponse } from "../api/client";
import { useRepoCardData } from "../hooks/useRepoCardData";
import { AddToComparisonModal } from "./AddToComparisonModal";
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
  const {
    badges,
    badgesLoading,
    tags,
    tagsLoading,
    activeSignalCount,
    refreshContext,
    isRefreshingContext,
  } = useRepoCardData(repo.id);
  const [showChart, setShowChart] = useState(false);
  const [showSimilar, setShowSimilar] = useState(false);
  const [showAddToComparison, setShowAddToComparison] = useState(false);
  const [healthDetails, setHealthDetails] = useState<HealthScoreResponse | null>(null);

  // Wrap state setter in callback to avoid passing raw setter to children
  const handleHealthDetailsChange = useCallback(
    (details: HealthScoreResponse | null) => setHealthDetails(details),
    []
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
        onToggleChart={() => setShowChart(!showChart)}
        onToggleSimilar={() => setShowSimilar(!showSimilar)}
        onFetch={() => onFetch(repo.id)}
        onRemove={() => onRemove(repo.id)}
        onRemoveFromCategory={
          selectedCategoryId && onRemoveFromCategory
            ? () => onRemoveFromCategory(selectedCategoryId, repo.id)
            : undefined
        }
        onAddToComparison={() => setShowAddToComparison(true)}
        onShowHealthDetails={handleHealthDetailsChange}
      />

      <RepoCardContent
        description={repo.description}
        badges={badges}
        badgesLoading={badgesLoading}
        tags={tags}
        tagsLoading={tagsLoading}
        onRefreshContext={refreshContext}
        isRefreshingContext={isRefreshingContext}
      />

      <RepoCardStats repo={repo} />

      <RepoCardPanels
        repoId={repo.id}
        showChart={showChart}
        showSimilar={showSimilar}
        healthDetails={healthDetails}
        onCloseSimilar={() => setShowSimilar(false)}
        onCloseHealth={() => setHealthDetails(null)}
        onRecalculateHealth={handleHealthDetailsChange}
      />

      {showAddToComparison && (
        <AddToComparisonModal
          repoId={repo.id}
          repoName={repo.full_name}
          onClose={() => setShowAddToComparison(false)}
          onSuccess={() => setShowAddToComparison(false)}
        />
      )}
    </div>
  );
}
