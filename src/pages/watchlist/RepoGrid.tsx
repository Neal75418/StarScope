/**
 * Grid 佈局的 Repo 列表（不使用虛擬滾動，適合少量 repos）。
 */

import { useEffect, useMemo } from "react";
import { RepoCard } from "../../components/RepoCard";
import type { RepoViewProps } from "./types";

export function RepoGrid({
  repos,
  loadingRepoId,
  onFetch,
  onRemove,
  selectedCategoryId,
  onRemoveFromCategory,
  batchData,
  onVisibleRangeChange,
  isSelectionMode,
  selectedIds,
  onToggleSelection,
}: RepoViewProps) {
  // Grid 模式不使用虛擬滾動，直接設定整個範圍讓 batch preload 載入全部
  useEffect(() => {
    onVisibleRangeChange({ start: 0, stop: repos.length });
  }, [repos.length, onVisibleRangeChange]);

  // 穩定化 categoryContext（所有 repo 共用同一個 reference）
  const categoryContext = useMemo(
    () =>
      selectedCategoryId ? { selectedId: selectedCategoryId, onRemoveFromCategory } : undefined,
    [selectedCategoryId, onRemoveFromCategory]
  );

  // 穩定化 handlers（所有 repo 共用）
  const handlers = useMemo(() => ({ onFetch, onRemove }), [onFetch, onRemove]);

  return (
    <div className="repo-grid" data-testid="repo-grid">
      {repos.map((repo) => {
        const preloaded = batchData[repo.id];
        return (
          <RepoCard
            key={repo.id}
            repo={repo}
            isLoading={loadingRepoId === repo.id}
            handlers={handlers}
            preloadedData={preloaded}
            compact
            categoryContext={categoryContext}
            selectionState={
              isSelectionMode && onToggleSelection
                ? {
                    isSelectionMode: true,
                    isSelected: selectedIds?.has(repo.id) ?? false,
                    onToggleSelection,
                  }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
