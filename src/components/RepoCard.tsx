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

interface RepoCardCategoryContext {
  selectedId?: number | null;
  onRemoveFromCategory?: (categoryId: number, repoId: number) => void;
}

interface RepoCardProps {
  repo: RepoWithSignals;
  isLoading?: boolean;
  handlers: RepoCardHandlers;
  preloadedData?: RepoCardPreloadedData;
  /** 由清單設定：批次載入負責供資料時，卡片不自行發請求。 */
  deferToBatch?: boolean;
  /** 外部控制圖表展開（虛擬滾動動態行高）。scalar 而非物件——inline 物件
   *  每次 render 都是新引用，會讓 memo 的淺比較必不等（第三方審查發現）。 */
  chartExpanded?: boolean;
  onChartToggle?: (repoId: number) => void;
  categoryContext?: RepoCardCategoryContext;
  compact?: boolean;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (repoId: number) => void;
}

export const RepoCard = memo(function RepoCard({
  repo,
  isLoading,
  handlers,
  preloadedData,
  deferToBatch = false,
  chartExpanded,
  onChartToggle,
  categoryContext,
  compact,
  isSelectionMode,
  isSelected,
  onToggleSelection,
}: RepoCardProps) {
  const { badges, badgesLoading, activeSignalCount } = useRepoCardData(
    repo.id,
    preloadedData,
    deferToBatch
  );
  // 圖表狀態：外部控制優先（虛擬滾動場景），否則使用內部狀態
  const [internalShowChart, setInternalShowChart] = useState(false);
  const showChart = chartExpanded ?? internalShowChart;
  // Memoize handler 以避免 memoized 子元件不必要的 re-render
  const handleToggleChart = useCallback(() => {
    if (onChartToggle) {
      onChartToggle(repo.id);
    } else {
      setInternalShowChart((prev) => !prev);
    }
  }, [onChartToggle, repo.id]);
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
    if (isSelectionMode && onToggleSelection) {
      onToggleSelection(repo.id);
    }
  }, [isSelectionMode, onToggleSelection, repo.id]);

  const cardClassName = [
    "repo-card",
    compact ? "repo-card-compact" : "",
    isSelectionMode ? "repo-card-selectable" : "",
    isSelected ? "repo-card-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isSelectionMode && onToggleSelection && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        onToggleSelection(repo.id);
      }
    },
    [isSelectionMode, onToggleSelection, repo.id]
  );

  return (
    <div
      className={cardClassName}
      {...(isSelectionMode
        ? {
            onClick: handleCardClick,
            onKeyDown: handleKeyDown,
            role: "button" as const,
            tabIndex: 0,
          }
        : {})}
    >
      {isSelectionMode && (
        <input
          type="checkbox"
          className="repo-card-checkbox"
          checked={isSelected ?? false}
          onChange={() => onToggleSelection?.(repo.id)}
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
