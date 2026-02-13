/**
 * Watchlist 頁面，顯示所有追蹤中的 repo。
 */

import { useCallback, useMemo } from "react";
import { List, RowComponentProps } from "react-window";
import { AutoSizer } from "react-virtualized-auto-sizer";
import { RepoCard } from "../components/RepoCard";
import { AddRepoDialog } from "../components/AddRepoDialog";
import { CategorySidebar } from "../components/CategorySidebar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
import { AnimatedPage } from "../components/motion";
import { useI18n, interpolate } from "../i18n";
import { useWatchlist } from "../hooks/useWatchlist";
import { useCategoryOperations } from "../hooks/useCategoryOperations";
import { useWindowedBatchRepoData } from "../hooks/useWindowedBatchRepoData";
import { RepoWithSignals } from "../api/client";

// 載入中狀態元件
function LoadingState() {
  const { t } = useI18n();
  return (
    <div className="page">
      <div className="loading">{t.common.loading}</div>
    </div>
  );
}

// 連線錯誤元件
function ConnectionError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="page">
      <div className="error-container">
        <h2>{t.watchlist.connection.title}</h2>
        <p>{t.watchlist.connection.message}</p>
        <p className="hint">{t.watchlist.connection.autoRetry}</p>
        <button onClick={onRetry} className="btn btn-primary">
          {t.watchlist.connection.retry}
        </button>
      </div>
    </div>
  );
}

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

// 虛擬滾動常數：RepoCard 高度 180px + 間距 16px = 196px
const REPO_CARD_HEIGHT = 180;
const REPO_CARD_GAP = 16;
const ITEM_SIZE = REPO_CARD_HEIGHT + REPO_CARD_GAP;

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
  // Row 渲染組件，由 List 調用
  const RowComponent = useCallback(
    ({ index, style }: RowComponentProps) => {
      const repo = repos[index];
      const preloaded = batchData[repo.id];

      return (
        <div style={style} className="virtual-repo-item">
          <RepoCard
            repo={repo}
            onFetch={onFetch}
            onRemove={onRemove}
            isLoading={loadingRepoId === repo.id}
            selectedCategoryId={selectedCategoryId}
            onRemoveFromCategory={onRemoveFromCategory}
            preloadedBadges={preloaded?.badges}
            preloadedSignals={preloaded?.signals}
          />
        </div>
      );
    },
    [repos, batchData, loadingRepoId, onFetch, onRemove, selectedCategoryId, onRemoveFromCategory]
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
              rowHeight={ITEM_SIZE}
              rowProps={{}}
              overscanCount={3}
              onRowsRendered={(range) => {
                onVisibleRangeChange({
                  start: range.startIndex,
                  stop: range.stopIndex,
                });
              }}
            />
          ) : null
        }
      />
    </div>
  );
}

// 錯誤橫幅元件
function ErrorBanner({ error, onClear }: { error: string; onClear: () => void }) {
  return (
    <div className="error-banner">
      {error}
      <button onClick={onClear}>x</button>
    </div>
  );
}

// 工具列元件
function Toolbar({
  onAddRepo,
  onRefreshAll,
  onRecalculateAll,
  isRefreshing,
  isRecalculating,
  selectedCategoryId,
  displayedCount,
  totalCount,
  searchQuery,
  onSearchChange,
}: {
  onAddRepo: () => void;
  onRefreshAll: () => void;
  onRecalculateAll: () => void;
  isRefreshing: boolean;
  isRecalculating: boolean;
  selectedCategoryId: number | null;
  displayedCount: number;
  totalCount: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="toolbar">
      <div className="toolbar-search">
        <input
          type="text"
          placeholder={t.watchlist.searchPlaceholder}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="search-input"
          data-testid="watchlist-search"
          aria-label={t.watchlist.searchPlaceholder}
        />
      </div>
      <button
        data-testid="add-repo-btn"
        onClick={onAddRepo}
        className="btn btn-primary"
        aria-label={t.watchlist.addRepo}
      >
        + {t.watchlist.addRepo}
      </button>
      <button
        data-testid="refresh-all-btn"
        onClick={onRefreshAll}
        disabled={isRefreshing}
        className="btn"
        aria-label={t.watchlist.refreshAll}
      >
        {isRefreshing ? t.watchlist.refreshing : t.watchlist.refreshAll}
      </button>
      <button
        onClick={onRecalculateAll}
        disabled={isRecalculating}
        className="btn"
        title={t.watchlist.recalculateAll}
        aria-label={t.watchlist.recalculateAll}
      >
        {isRecalculating ? t.watchlist.recalculating : t.watchlist.recalculateAll}
      </button>
      {(selectedCategoryId || searchQuery) && (
        <span className="filter-indicator">
          {interpolate(t.watchlist.showing, {
            count: displayedCount,
            total: totalCount,
          })}
        </span>
      )}
    </div>
  );
}

// Watchlist 主元件
export function Watchlist() {
  const { t } = useI18n();
  const { state, dialog, category, actions, removeConfirm, toast } = useWatchlist();

  // 視窗化批次載入：僅載入可見範圍的 repo 資料
  const repoIds = useMemo(() => state.repos.map((r) => r.id), [state.repos]);
  const { dataMap: batchData, setVisibleRange } = useWindowedBatchRepoData(repoIds, {
    bufferSize: 10,
  });

  // 分類操作：新增 / 移除 repo 至分類
  const categoryOps = useCategoryOperations(category.refresh, (msg) => toast.error(msg));

  // Memoize handler 以避免不必要的 re-render
  const handleRemoveFromCategory = useCallback(
    async (categoryId: number, repoId: number) => {
      const success = await categoryOps.removeFromCategory(categoryId, repoId);
      if (success) {
        toast.success(t.categories.removedFromCategory);
      }
    },
    [categoryOps, toast, t.categories.removedFromCategory]
  );

  if (state.isLoading) {
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
          selectedCategoryId={category.selectedId}
          onSelectCategory={category.setSelectedId}
        />

        <div className="watchlist-main">
          <Toolbar
            onAddRepo={dialog.open}
            onRefreshAll={actions.refreshAll}
            onRecalculateAll={actions.recalculateAll}
            isRefreshing={state.isRefreshing}
            isRecalculating={state.isRecalculatingSimilarities}
            selectedCategoryId={category.selectedId}
            displayedCount={state.displayedRepos.length}
            totalCount={state.repos.length}
            searchQuery={category.searchQuery}
            onSearchChange={category.setSearchQuery}
          />

          {state.error && <ErrorBanner error={state.error} onClear={actions.clearError} />}

          <div className="repo-list" data-testid="repo-list">
            {state.displayedRepos.length === 0 ? (
              <div className="empty-state" data-testid="empty-state">
                <EmptyStateView
                  hasRepos={state.repos.length > 0}
                  hasSearch={category.searchQuery.trim().length > 0}
                  onAddRepo={dialog.open}
                />
              </div>
            ) : (
              <RepoList
                repos={state.displayedRepos}
                loadingRepoId={state.loadingRepoId}
                onFetch={actions.fetchRepo}
                onRemove={actions.remove}
                selectedCategoryId={category.selectedId}
                batchData={batchData}
                onRemoveFromCategory={handleRemoveFromCategory}
                onVisibleRangeChange={setVisibleRange}
              />
            )}
          </div>
        </div>
      </div>

      <AddRepoDialog
        isOpen={dialog.isOpen}
        onClose={dialog.close}
        onAdd={dialog.submit}
        isLoading={dialog.isAdding}
        error={dialog.error}
      />

      <ConfirmDialog
        isOpen={removeConfirm.isOpen}
        title={t.dialog.removeRepo.title}
        message={interpolate(t.dialog.removeRepo.message, {
          name: removeConfirm.repoName,
        })}
        confirmText={t.dialog.removeRepo.confirm}
        variant="danger"
        onConfirm={actions.confirmRemove}
        onCancel={actions.cancelRemove}
      />

      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
    </AnimatedPage>
  );
}
