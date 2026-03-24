/**
 * Repo 卡片元件，顯示 repo 資訊、訊號與情境徽章。
 */

import { useState, useCallback, memo, useMemo } from "react";
import type { KeyboardEvent } from "react";
import type { ContextBadge, EarlySignal, RepoWithSignals } from "../api/client";
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

interface RepoCardSelectionState {
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelection: (repoId: number) => void;
}

interface RepoCardProps {
  repo: RepoWithSignals;
  isLoading?: boolean;
  handlers: RepoCardHandlers;
  preloadedData?: RepoCardPreloadedData;
  chartState?: RepoCardChartState;
  categoryContext?: RepoCardCategoryContext;
  compact?: boolean;
  selectionState?: RepoCardSelectionState;
}

export const RepoCard = memo(function RepoCard({
  repo,
  isLoading,
  handlers,
  preloadedData,
  chartState,
  categoryContext,
  compact,
  selectionState,
}: RepoCardProps) {
  const { badges, badgesLoading, activeSignalCount } = useRepoCardData(repo.id, preloadedData);
  // 圖表狀態：外部控制優先（虛擬滾動場景），否則使用內部狀態
  const [internalShowChart, setInternalShowChart] = useState(false);
  const showChart = chartState?.expanded ?? internalShowChart;
  // Memoize handler 以避免 memoized 子元件不必要的 re-render
  const handleToggleChart = useCallback(() => {
    if (chartState?.onToggle) {
      chartState.onToggle(repo.id);
    } else {
      setInternalShowChart((prev) => !prev);
    }
  }, [chartState, repo.id]);
  const handleFetch = useCallback(() => handlers.onFetch(repo.id), [handlers, repo.id]);
  const handleRemove = useCallback(() => handlers.onRemove(repo.id), [handlers, repo.id]);
  const handleRemoveFromCategory = useCallback(
    () =>
      categoryContext?.selectedId &&
      categoryContext.onRemoveFromCategory?.(categoryContext.selectedId, repo.id),
    [categoryContext, repo.id]
  );
  const stableOnRemoveFromCategory = useMemo(
    () =>
      categoryContext?.selectedId && categoryContext.onRemoveFromCategory
        ? handleRemoveFromCategory
        : undefined,
    [categoryContext?.selectedId, categoryContext?.onRemoveFromCategory, handleRemoveFromCategory]
  );

  const handleCardClick = useCallback(() => {
    if (selectionState?.isSelectionMode) {
      selectionState.onToggleSelection(repo.id);
    }
  }, [selectionState, repo.id]);

  const cardClassName = [
    "repo-card",
    compact ? "repo-card-compact" : "",
    selectionState?.isSelectionMode ? "repo-card-selectable" : "",
    selectionState?.isSelected ? "repo-card-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (selectionState?.isSelectionMode && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        selectionState.onToggleSelection(repo.id);
      }
    },
    [selectionState, repo.id]
  );

  return (
    <div
      className={cardClassName}
      {...(selectionState?.isSelectionMode
        ? {
            onClick: handleCardClick,
            onKeyDown: handleKeyDown,
            role: "button" as const,
            tabIndex: 0,
          }
        : {})}
    >
      {selectionState?.isSelectionMode && (
        <input
          type="checkbox"
          className="repo-card-checkbox"
          checked={selectionState.isSelected}
          onChange={() => selectionState.onToggleSelection(repo.id)}
          data-testid={`repo-select-${repo.id}`}
        />
      )}
      <RepoCardHeader
        repo={repo}
        showChart={showChart}
        isLoading={isLoading}
        selectedCategoryId={categoryContext?.selectedId}
        activeSignalCount={activeSignalCount}
        onToggleChart={handleToggleChart}
        onFetch={handleFetch}
        onRemove={handleRemove}
        onRemoveFromCategory={stableOnRemoveFromCategory}
      />

      <RepoCardContent
        repoId={repo.id}
        description={repo.description}
        badges={badges}
        badgesLoading={badgesLoading}
      />

      {!compact && <RepoCardStats repo={repo} />}

      {!compact && <RepoCardPanels repoId={repo.id} showChart={showChart} />}
    </div>
  );
});
