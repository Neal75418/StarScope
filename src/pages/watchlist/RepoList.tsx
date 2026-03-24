import { useCallback, useState } from "react";
import { List, RowComponentProps } from "react-window";
import { AutoSizer } from "react-virtualized-auto-sizer";
import { RepoCard } from "../../components/RepoCard";
import type { RepoWithSignals } from "../../api/client";
import type { useWindowedBatchRepoData } from "../../hooks/useWindowedBatchRepoData";

// 虛擬滾動常數
const REPO_CARD_GAP = 16;
const COLLAPSED_ITEM_SIZE = 220 + REPO_CARD_GAP; // 收合狀態：卡片 ≤2行描述 ~218px + 安全邊距 + 間距
const CHART_EXTRA_HEIGHT = 300; // 圖表展開額外高度（chart 180px + controls + padding + backfill）
const EXPANDED_ITEM_SIZE = COLLAPSED_ITEM_SIZE + CHART_EXTRA_HEIGHT;
// 穩定的空物件引用，避免觸發不必要的重新渲染
const EMPTY_ROW_PROPS = {};

export function RepoList({
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
  // 追蹤哪些 repo 的圖表已展開（提升到此層以控制虛擬滾動行高）
  const [expandedCharts, setExpandedCharts] = useState<Set<number>>(new Set());

  const handleChartToggle = useCallback((repoId: number) => {
    setExpandedCharts((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) {
        next.delete(repoId);
      } else {
        next.add(repoId);
      }
      return next;
    });
  }, []);

  // 動態行高：根據圖表展開狀態返回不同高度
  const getRowHeight = useCallback(
    (index: number) => {
      const repo = repos[index];
      return expandedCharts.has(repo?.id) ? EXPANDED_ITEM_SIZE : COLLAPSED_ITEM_SIZE;
    },
    [repos, expandedCharts]
  );

  // 穩定化 onRowsRendered 回調，避免每次渲染都創建新函數
  const handleRowsRendered = useCallback(
    (range: { startIndex: number; stopIndex: number }) => {
      onVisibleRangeChange({
        start: range.startIndex,
        stop: range.stopIndex,
      });
    },
    [onVisibleRangeChange]
  );

  // Row 渲染組件，由 List 調用
  const RowComponent = useCallback(
    ({ index, style }: RowComponentProps) => {
      const repo = repos[index];
      const preloaded = batchData[repo.id];

      return (
        <div style={style} className="virtual-repo-item">
          <RepoCard
            repo={repo}
            isLoading={loadingRepoId === repo.id}
            handlers={{
              onFetch,
              onRemove,
            }}
            preloadedData={preloaded}
            chartState={{
              expanded: expandedCharts.has(repo.id),
              onToggle: handleChartToggle,
            }}
            categoryContext={
              selectedCategoryId
                ? {
                    selectedId: selectedCategoryId,
                    onRemoveFromCategory,
                  }
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
        </div>
      );
    },
    [
      repos,
      batchData,
      loadingRepoId,
      onFetch,
      onRemove,
      selectedCategoryId,
      onRemoveFromCategory,
      expandedCharts,
      handleChartToggle,
      isSelectionMode,
      selectedIds,
      onToggleSelection,
    ]
  );

  return (
    <div className="virtual-repo-list" style={{ height: "calc(100vh - 200px)" }}>
      <AutoSizer
        renderProp={({ height, width }) =>
          height && width ? (
            <List
              style={{ height, width }}
              rowComponent={RowComponent}
              rowCount={repos.length}
              rowHeight={getRowHeight}
              rowProps={EMPTY_ROW_PROPS}
              overscanCount={5}
              onRowsRendered={handleRowsRendered}
            />
          ) : null
        }
      />
    </div>
  );
}
