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
import { List, RowComponentProps, useDynamicRowHeight } from "react-window";
import { AutoSizer } from "react-virtualized-auto-sizer";
import { RepoCard } from "../../components/RepoCard";
import type { RepoViewProps } from "./types";
import type { RepoWithSignals } from "../../api/client";
import type { BatchRepoData } from "../../hooks/useWindowedBatchRepoData";

// 列高照每一列實際量到的（useDynamicRowHeight 用 ResizeObserver 量 .virtual-repo-item，含 padding-bottom 的間距）：
// 展開的圖表、回填列換行、重讀失敗多一列、HN 討論面板打開，高度都跟著內容走，不會被裁掉。
// 這個值只是還沒量到之前的估計：收合的卡片（≤2 行描述）約 218px＋間距 16px
const ESTIMATED_ROW_HEIGHT = 236;

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
  ariaAttributes,
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
    // ariaAttributes：react-window 靠 aria-posinset 把元素對到位置（決定量到的高度寫進快取的哪一格），也給 role="listitem"
    <div style={style} className="virtual-repo-item" {...ariaAttributes}>
      <RepoCard
        repo={repo}
        isLoading={loadingRepoId === repo.id}
        handlers={handlers}
        preloadedData={batchData[repo.id]}
        deferToBatch={batchOwnsData}
        chartExpanded={expandedCharts.has(repo.id)}
        onChartToggle={onChartToggle}
        categoryContext={categoryContext}
        isSelectionMode={Boolean(selectionState)}
        isSelected={selectionState?.selectedIds.has(repo.id) ?? false}
        onToggleSelection={selectionState?.onToggleSelection}
      />
    </div>
  );
}

/**
 * 每一列的 key 用 repo id，不用位置：react-window 預設拿 index 當 key，排序、篩選、刪掉上面一筆之後，
 * 展開中的卡片元件（圖表的時間範圍等 state）會直接換給別的 repo 繼續用。
 * 模組層級：react-window 在 render 時呼叫它、不會自動 memo，引用要穩定
 */
function repoRowKey(index: number, { repos }: RepoRowProps): number {
  return repos[index].id;
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
  // 追蹤哪些 repo 的圖表已展開。放在清單這一層：列被虛擬化卸載、再掛回來時圖表仍保持展開（放在卡片自己的 state 會跟著卸載）
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

  // 高度快取以位置（index）為 key：順序變了，react-window 會在 rowProps 換了之後重新觀察每一列、照新的位置量一次
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: ESTIMATED_ROW_HEIGHT });

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
  // 每次 render 新建物件會讓 RepoCard 的 memo 全部 miss（同類陷阱見 .claude/rules/frontend.md 的 React-Window 一節）
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
              rowKey={repoRowKey}
              rowCount={repos.length}
              rowHeight={rowHeight}
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
