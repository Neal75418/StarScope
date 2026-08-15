/**
 * 追蹤清單的虛擬滾動列表檢視（react-window）。
 *
 * ⚠️ `rowComponent` 必須是「模組層級的穩定引用」，資料一律走 `rowProps`。
 * react-window v2 內部是 `useMemo(() => memo(rowComponent), [rowComponent])`
 * （見 node_modules/react-window/dist/react-window.js）——rowComponent 換引用
 * 就產生新的元件型別，React 會把整組可見 row **卸載重掛**而不是重繪：
 * 每張卡的 React Query observer 全部重新註冊、DOM 子樹重建，展開中的圖表
 * 時間範圍也會被重置。用 useCallback 包起來一樣會換引用（它有十幾個依賴，
 * 批次資料每到貨一次、勾選任一 checkbox 都會變）。
 */
import { useCallback, useMemo, useState } from "react";
import { List, RowComponentProps } from "react-window";
import { AutoSizer } from "react-virtualized-auto-sizer";
import { RepoCard } from "../../components/RepoCard";
import { STARS_CHART_HEIGHT } from "../../components/StarsChart";
import type { RepoViewProps } from "./types";
import type { RepoWithSignals } from "../../api/client";
import type { BatchRepoData } from "../../hooks/useWindowedBatchRepoData";

// 虛擬滾動常數
const REPO_CARD_GAP = 16;
const COLLAPSED_ITEM_SIZE = 220 + REPO_CARD_GAP; // 收合狀態：卡片 ≤2行描述 ~218px + 安全邊距 + 間距
const CHART_EXTRA_HEIGHT = STARS_CHART_HEIGHT + 120; // chart + controls + padding + backfill
const EXPANDED_ITEM_SIZE = COLLAPSED_ITEM_SIZE + CHART_EXTRA_HEIGHT;

/** 傳給 row 的所有資料。react-window 對 rowProps 做逐值淺比較，所以每個值要引用穩定。 */
interface RepoRowProps {
  repos: RepoWithSignals[];
  batchData: Record<number, BatchRepoData>;
  batchOwnsData: boolean;
  loadingRepoId: number | null;
  expandedCharts: Set<number>;
  onChartToggle: (repoId: number) => void;
  handlers: { onFetch: (id: number) => void; onRemove: (id: number) => void };
  categoryContext?: { selectedId: number; onRemoveFromCategory?: (c: number, r: number) => void };
  selectionState?: {
    isSelectionMode: true;
    selectedIds: Set<number>;
    onToggleSelection: (repoId: number) => void;
  };
}

function RepoRow({
  index,
  style,
  repos,
  batchData,
  batchOwnsData,
  loadingRepoId,
  expandedCharts,
  onChartToggle,
  handlers,
  categoryContext,
  selectionState,
}: RowComponentProps<RepoRowProps>) {
  const repo = repos[index];
  if (!repo) return null;

  return (
    <div style={style} className="virtual-repo-item">
      <RepoCard
        repo={repo}
        isLoading={loadingRepoId === repo.id}
        handlers={handlers}
        preloadedData={batchData[repo.id]}
        deferToBatch={batchOwnsData}
        chartState={{
          expanded: expandedCharts.has(repo.id),
          onToggle: onChartToggle,
        }}
        categoryContext={categoryContext}
        selectionState={
          selectionState
            ? {
                isSelectionMode: true,
                isSelected: selectionState.selectedIds.has(repo.id),
                onToggleSelection: selectionState.onToggleSelection,
              }
            : undefined
        }
      />
    </div>
  );
}

export function RepoList({
  repos,
  loadingRepoId,
  onFetch,
  onRemove,
  selectedCategoryId,
  onRemoveFromCategory,
  batchData,
  batchOwnsData,
  onVisibleRangeChange,
  isSelectionMode,
  selectedIds,
  onToggleSelection,
}: RepoViewProps) {
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

  // 以下三個物件都要 memo：它們進 rowProps 後被逐值淺比較，
  // 每次 render 新建物件會讓 RepoCard 的 memo 全部 miss（CLAUDE.md 明列的 pitfall）
  const handlers = useMemo(() => ({ onFetch, onRemove }), [onFetch, onRemove]);

  const categoryContext = useMemo(
    () =>
      selectedCategoryId ? { selectedId: selectedCategoryId, onRemoveFromCategory } : undefined,
    [selectedCategoryId, onRemoveFromCategory]
  );

  const selectionState = useMemo(
    () =>
      isSelectionMode && onToggleSelection
        ? {
            isSelectionMode: true as const,
            selectedIds: selectedIds ?? new Set<number>(),
            onToggleSelection,
          }
        : undefined,
    [isSelectionMode, selectedIds, onToggleSelection]
  );

  const rowProps = useMemo(
    (): RepoRowProps => ({
      repos,
      batchData,
      batchOwnsData,
      loadingRepoId,
      expandedCharts,
      onChartToggle: handleChartToggle,
      handlers,
      categoryContext,
      selectionState,
    }),
    [
      repos,
      batchData,
      batchOwnsData,
      loadingRepoId,
      expandedCharts,
      handleChartToggle,
      handlers,
      categoryContext,
      selectionState,
    ]
  );

  return (
    <div className="virtual-repo-list" style={{ height: "calc(100vh - 200px)" }}>
      <AutoSizer
        renderProp={({ height, width }) =>
          height && width ? (
            <List
              style={{ height, width }}
              rowComponent={RepoRow}
              rowCount={repos.length}
              rowHeight={getRowHeight}
              rowProps={rowProps}
              overscanCount={5}
              onRowsRendered={handleRowsRendered}
            />
          ) : null
        }
      />
    </div>
  );
}
