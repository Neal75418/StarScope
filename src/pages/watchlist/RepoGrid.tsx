/**
 * Grid 佈局的 Repo 列表（不使用虛擬滾動，適合少量 repos）。
 */

import { useEffect } from "react";
import { RepoCard } from "../../components/RepoCard";
import { RepoWithSignals } from "../../api/client";
import type { useWindowedBatchRepoData } from "../../hooks/useWindowedBatchRepoData";

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
}: {
  repos: RepoWithSignals[];
  loadingRepoId: number | null;
  onFetch: (id: number) => void;
  onRemove: (id: number) => void;
  selectedCategoryId?: number | null;
  onRemoveFromCategory?: (categoryId: number, repoId: number) => void;
  batchData: ReturnType<typeof useWindowedBatchRepoData>["dataMap"];
  onVisibleRangeChange: (range: { start: number; stop: number }) => void;
  isSelectionMode?: boolean;
  selectedIds?: Set<number>;
  onToggleSelection?: (repoId: number) => void;
}) {
  // Grid 模式不使用虛擬滾動，直接設定整個範圍讓 batch preload 載入全部
  useEffect(() => {
    onVisibleRangeChange({ start: 0, stop: repos.length });
  }, [repos.length, onVisibleRangeChange]);

  return (
    <div className="repo-grid" data-testid="repo-grid">
      {repos.map((repo) => {
        const preloaded = batchData[repo.id];
        return (
          <RepoCard
            key={repo.id}
            repo={repo}
            isLoading={loadingRepoId === repo.id}
            handlers={{ onFetch, onRemove }}
            preloadedData={preloaded}
            compact
            categoryContext={
              selectedCategoryId
                ? { selectedId: selectedCategoryId, onRemoveFromCategory }
                : undefined
            }
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
