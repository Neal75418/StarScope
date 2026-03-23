/**
 * Watchlist 頁面，顯示所有追蹤中的 repo。
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { AddRepoDialog } from "../components/AddRepoDialog";
import { CategorySidebar } from "../components/CategorySidebar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
import { AnimatedPage } from "../components/motion";
import { useI18n, interpolate } from "../i18n";
import { useWatchlistState, useWatchlistActions } from "../contexts/WatchlistContext";
import {
  useSortedFilteredRepos,
  useLoadingRepo,
  useIsRefreshing,
  useIsRecalculating,
  useIsInitializing,
} from "../hooks/selectors/useWatchlistSelectors";
import { useCategoryOperations } from "../hooks/useCategoryOperations";
import { useWatchlistSort } from "../hooks/useWatchlistSort";
import { useViewMode } from "../hooks/useViewMode";
import { useWindowedBatchRepoData } from "../hooks/useWindowedBatchRepoData";
import { useSelectionMode } from "../hooks/useSelectionMode";
import { useWatchlistBatchActions } from "../hooks/useWatchlistBatchActions";
import { STORAGE_KEYS } from "../constants/storage";
import { LoadingState } from "./watchlist/LoadingState";
import { ConnectionError } from "./watchlist/ConnectionError";
import { ErrorBanner } from "./watchlist/ErrorBanner";
import { Toolbar } from "./watchlist/Toolbar";
import { EmptyStateView } from "./watchlist/EmptyStateView";
import { RepoList } from "./watchlist/RepoList";
import { RepoGrid } from "./watchlist/RepoGrid";
import { SummaryPanel } from "./watchlist/SummaryPanel";
import { BatchActionBar } from "./watchlist/BatchActionBar";

// Watchlist 主元件
export function Watchlist() {
  const { t } = useI18n();

  // 新的 Context hooks
  const state = useWatchlistState();
  const actions = useWatchlistActions();

  // 排序 + 檢視模式 hooks
  const { sortKey, sortDirection, setSort } = useWatchlistSort();
  const { viewMode, setViewMode } = useViewMode(STORAGE_KEYS.WATCHLIST_VIEW_MODE);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Selector hooks - 精準訂閱，減少 re-render
  const displayedRepos = useSortedFilteredRepos(sortKey, sortDirection);
  const loadingRepoId = useLoadingRepo();
  const isRefreshing = useIsRefreshing();
  const isRecalculating = useIsRecalculating();
  const isInitializing = useIsInitializing();

  // 視窗化批次載入：僅載入可見範圍的 repo 資料
  const repoIds = useMemo(() => state.repos.map((r) => r.id), [state.repos]);
  const { dataMap: batchData, setVisibleRange } = useWindowedBatchRepoData(repoIds, {
    bufferSize: 10,
  });

  // 從 batchData 提取 signals map（給 SummaryPanel 使用）
  const batchSignals = useMemo(() => {
    const map: Record<number, (typeof batchData)[number]["signals"] | undefined> = {};
    for (const [id, data] of Object.entries(batchData)) {
      map[Number(id)] = data?.signals;
    }
    return map;
  }, [batchData]);

  // 批次操作
  const selection = useSelectionMode();
  const batchActions = useWatchlistBatchActions(selection.selectedIds, actions);

  // 當可見 repo 集合改變時，修剪 selection（分類切換、搜尋、batch 操作後）
  const displayedRepoIdSet = useMemo(
    () => new Set(displayedRepos.map((r) => r.id)),
    [displayedRepos]
  );
  useEffect(() => {
    if (selection.isActive) {
      selection.reconcile(displayedRepoIdSet);
    }
    // selection is a plain object literal — decompose to stable refs to avoid infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedRepoIdSet, selection.isActive, selection.reconcile]);

  const handleSelectAll = useCallback(() => {
    selection.selectAll(displayedRepos.map((r) => r.id));
  }, [selection, displayedRepos]);

  const handleBatchDone = useCallback(() => {
    selection.exit();
    actions.success(t.watchlist.batch.done);
  }, [selection, actions, t.watchlist.batch.done]);

  const handleBatchError = useCallback(
    (msg: string) => {
      actions.error(msg);
    },
    [actions]
  );

  const handlePruneSelection = useCallback(
    (keepIds: number[]) => {
      selection.selectAll(keepIds);
    },
    [selection]
  );

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

  const handleAddRepo = useCallback(
    async (input: string) => {
      const result = await actions.addRepo(input);
      if (result.success) {
        actions.success(t.toast.repoAdded);
      }
    },
    [actions, t.toast.repoAdded]
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
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSortChange={setSort}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            searchInputRef={searchInputRef}
            isSelectionMode={selection.isActive}
            onEnterSelectionMode={selection.enter}
            onExitSelectionMode={selection.exit}
            onSelectAll={handleSelectAll}
            selectedCount={selection.selectedCount}
          />

          {state.error && <ErrorBanner error={state.error} onClear={actions.clearError} />}

          <SummaryPanel repos={state.repos} batchSignals={batchSignals} />

          <div className="repo-list" data-testid="repo-list">
            {displayedRepos.length === 0 ? (
              <div className="empty-state" data-testid="empty-state">
                <EmptyStateView
                  hasRepos={state.repos.length > 0}
                  hasSearch={state.filters.searchQuery.trim().length > 0}
                  onAddRepo={actions.openDialog}
                />
              </div>
            ) : viewMode === "grid" ? (
              <RepoGrid
                repos={displayedRepos}
                loadingRepoId={loadingRepoId}
                onFetch={actions.fetchRepo}
                onRemove={handleRemove}
                selectedCategoryId={state.filters.selectedCategoryId}
                batchData={batchData}
                onRemoveFromCategory={handleRemoveFromCategory}
                onVisibleRangeChange={setVisibleRange}
                isSelectionMode={selection.isActive}
                selectedIds={selection.selectedIds}
                onToggleSelection={selection.toggleSelection}
              />
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
                isSelectionMode={selection.isActive}
                selectedIds={selection.selectedIds}
                onToggleSelection={selection.toggleSelection}
              />
            )}
          </div>

          {selection.isActive && (
            <BatchActionBar
              selectedCount={selection.selectedCount}
              isProcessing={batchActions.isProcessing}
              onBatchAddToCategory={batchActions.batchAddToCategory}
              onBatchRefresh={batchActions.batchRefresh}
              onBatchRemove={batchActions.batchRemove}
              onPruneSelection={handlePruneSelection}
              onDone={handleBatchDone}
              onError={handleBatchError}
            />
          )}
        </div>
      </div>

      <AddRepoDialog
        isOpen={state.ui.dialog.isOpen}
        onClose={actions.closeDialog}
        onAdd={handleAddRepo}
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
        isProcessing={state.loadingState.type === "removing"}
        onConfirm={actions.confirmRemove}
        onCancel={actions.cancelRemove}
      />

      <ToastContainer toasts={state.toasts} onDismiss={actions.dismissToast} />
    </AnimatedPage>
  );
}
