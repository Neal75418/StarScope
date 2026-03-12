/**
 * Watchlist 頁面，顯示所有追蹤中的 repo。
 */

import { useCallback, useMemo } from "react";
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
import { LoadingState } from "./watchlist/LoadingState";
import { ConnectionError } from "./watchlist/ConnectionError";
import { ErrorBanner } from "./watchlist/ErrorBanner";
import { Toolbar } from "./watchlist/Toolbar";
import { EmptyStateView } from "./watchlist/EmptyStateView";
import { RepoList } from "./watchlist/RepoList";

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
