/**
 * Watchlist 頁面，顯示所有追蹤中的 repo。
 */

import { useCallback, useMemo, useState } from "react";
import { List, RowComponentProps } from "react-window";
import { AutoSizer } from "react-virtualized-auto-sizer";
import { RepoCard } from "../components/RepoCard";
import { AddRepoDialog } from "../components/AddRepoDialog";
import { CategorySidebar } from "../components/CategorySidebar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
import { AnimatedPage } from "../components/motion";
import { useI18n, interpolate } from "../i18n";
import { useWatchlistState, useWatchlistActions } from "../contexts/WatchlistContext";
import {
  useFilteredRepos,
  useLoadingRepo,
  useIsRefreshing,
  useIsRecalculating,
  useIsInitializing,
} from "../hooks/selectors/useWatchlistSelectors";
import { useCategoryOperations } from "../hooks/useCategoryOperations";
import { useWindowedBatchRepoData } from "../hooks/useWindowedBatchRepoData";
import { RepoWithSignals } from "../api/client";
import { LoadingState } from "./watchlist/LoadingState";
import { ConnectionError } from "./watchlist/ConnectionError";
import { ErrorBanner } from "./watchlist/ErrorBanner";
import { Toolbar } from "./watchlist/Toolbar";

// 空狀態元件
function EmptyStateView({
  hasRepos,
  hasSearch,
  onAddRepo,
}: {
  hasRepos: boolean;
  hasSearch: boolean;
  onAddRepo: () => void;
}) {
  const { t } = useI18n();

  if (!hasRepos) {
    return (
      <EmptyState
        title={t.watchlist.empty.noRepos}
        description={t.watchlist.empty.addPrompt}
        actionLabel={t.watchlist.addRepo}
        onAction={onAddRepo}
      />
    );
  }
  if (hasSearch) {
    return (
      <EmptyState
        title={t.watchlist.empty.noSearch}
        description={t.watchlist.empty.noSearchDesc}
        icon={
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        }
      />
    );
  }
  // 分類篩選啟用但無匹配 repo
  return (
    <EmptyState
      title={t.watchlist.empty.noCategory}
      description={t.watchlist.empty.noCategoryDesc}
      icon={
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      }
    />
  );
}

import { EmptyState } from "../components/EmptyState";

// 虛擬滾動常數
const REPO_CARD_GAP = 16;
const COLLAPSED_ITEM_SIZE = 280 + REPO_CARD_GAP; // 收合狀態：卡片 280px + 間距
const CHART_EXTRA_HEIGHT = 300; // 圖表展開額外高度（chart 180px + controls + padding + backfill）
const EXPANDED_ITEM_SIZE = COLLAPSED_ITEM_SIZE + CHART_EXTRA_HEIGHT;
// 穩定的空物件引用，避免觸發不必要的重新渲染
const EMPTY_ROW_PROPS = {};

function RepoList({
  repos,
  loadingRepoId,
  onFetch,
  onRemove,
  selectedCategoryId,
  onRemoveFromCategory,
  batchData,
  onVisibleRangeChange,
}: {
  repos: RepoWithSignals[];
  loadingRepoId: number | null;
  onFetch: (id: number) => void;
  onRemove: (id: number) => void;
  selectedCategoryId?: number | null;
  onRemoveFromCategory?: (categoryId: number, repoId: number) => void;
  batchData: ReturnType<typeof useWindowedBatchRepoData>["dataMap"];
  onVisibleRangeChange: (range: { start: number; stop: number }) => void;
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

// Watchlist 主元件
export function Watchlist() {
  const { t } = useI18n();

  // 新的 Context hooks
  const state = useWatchlistState();
  const actions = useWatchlistActions();

  // Selector hooks - 精準訂閱，減少 re-render
  const displayedRepos = useFilteredRepos();
  const loadingRepoId = useLoadingRepo();
  const isRefreshing = useIsRefreshing();
  const isRecalculating = useIsRecalculating();
  const isInitializing = useIsInitializing();

  // 視窗化批次載入：僅載入可見範圍的 repo 資料
  const repoIds = useMemo(() => state.repos.map((r) => r.id), [state.repos]);
  const { dataMap: batchData, setVisibleRange } = useWindowedBatchRepoData(repoIds, {
    bufferSize: 10,
  });

  // 分類操作：新增 / 移除 repo 至分類，成功後刷新資料
  const categoryOps = useCategoryOperations(actions.refreshAll, actions.error);

  // Memoize handlers 以避免不必要的 re-render
  const handleRemove = useCallback(
    (repoId: number) => {
      const repo = state.repos.find((r) => r.id === repoId);
      if (repo) {
        actions.openRemoveConfirm(repoId, repo.full_name);
      }
    },
    [state.repos, actions]
  );

  const handleRemoveFromCategory = useCallback(
    async (categoryId: number, repoId: number) => {
      const success = await categoryOps.removeFromCategory(categoryId, repoId);
      if (success) {
        actions.success(t.categories.removedFromCategory);
      }
    },
    [categoryOps, actions, t.categories.removedFromCategory]
  );

  if (isInitializing) {
    return <LoadingState />;
  }

  if (!state.isConnected) {
    return <ConnectionError onRetry={actions.retry} />;
  }

  return (
    <AnimatedPage className="page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.watchlist.title}</h1>
        <p className="subtitle">{t.watchlist.subtitle}</p>
      </header>

      <div className="watchlist-with-sidebar">
        <CategorySidebar
          selectedCategoryId={state.filters.selectedCategoryId}
          onSelectCategory={actions.setCategory}
        />

        <div className="watchlist-main">
          <Toolbar
            onAddRepo={actions.openDialog}
            onRefreshAll={actions.refreshAll}
            onRecalculateAll={actions.recalculateAll}
            isRefreshing={isRefreshing}
            isRecalculating={isRecalculating}
            selectedCategoryId={state.filters.selectedCategoryId}
            displayedCount={displayedRepos.length}
            totalCount={state.repos.length}
            searchQuery={state.filters.searchQuery}
            onSearchChange={actions.setSearchQuery}
          />

          {state.error && <ErrorBanner error={state.error} onClear={actions.clearError} />}

          <div className="repo-list" data-testid="repo-list">
            {displayedRepos.length === 0 ? (
              <div className="empty-state" data-testid="empty-state">
                <EmptyStateView
                  hasRepos={state.repos.length > 0}
                  hasSearch={state.filters.searchQuery.trim().length > 0}
                  onAddRepo={actions.openDialog}
                />
              </div>
            ) : (
              <RepoList
                repos={displayedRepos}
                loadingRepoId={loadingRepoId}
                onFetch={actions.fetchRepo}
                onRemove={handleRemove}
                selectedCategoryId={state.filters.selectedCategoryId}
                batchData={batchData}
                onRemoveFromCategory={handleRemoveFromCategory}
                onVisibleRangeChange={setVisibleRange}
              />
            )}
          </div>
        </div>
      </div>

      <AddRepoDialog
        isOpen={state.ui.dialog.isOpen}
        onClose={actions.closeDialog}
        onAdd={async (input: string) => {
          const result = await actions.addRepo(input);
          if (result.success) {
            actions.success(t.toast.repoAdded);
          }
        }}
        isLoading={state.loadingState.type === "adding"}
        error={state.ui.dialog.error}
      />

      <ConfirmDialog
        isOpen={state.ui.removeConfirm.isOpen}
        title={t.dialog.removeRepo.title}
        message={interpolate(t.dialog.removeRepo.message, {
          name: state.ui.removeConfirm.repoName,
        })}
        confirmText={t.dialog.removeRepo.confirm}
        variant="danger"
        onConfirm={actions.confirmRemove}
        onCancel={actions.cancelRemove}
      />

      <ToastContainer toasts={state.toasts} onDismiss={actions.dismissToast} />
    </AnimatedPage>
  );
}
