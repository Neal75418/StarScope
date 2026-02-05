/**
 * Watchlist page - main view showing all tracked repositories.
 */

import { RepoCard } from "../components/RepoCard";
import { AddRepoDialog } from "../components/AddRepoDialog";
import { CategorySidebar } from "../components/CategorySidebar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
import { AnimatedPage } from "../components/motion";
import { useI18n, interpolate } from "../i18n";
import { useWatchlist } from "../hooks/useWatchlist";
import { useCategoryOperations } from "../hooks/useCategoryOperations";
import { RepoWithSignals } from "../api/client";

// Loading state component
function LoadingState() {
  const { t } = useI18n();
  return (
    <div className="page">
      <div className="loading">{t.common.loading}</div>
    </div>
  );
}

// Connection error component
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

// Empty state component
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
        description="Try adjusting your search terms"
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
  // Category filter active but no repos match
  return (
    <EmptyState
      title={t.watchlist.empty.noCategory}
      description="No repositories in this category"
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

// Virtualized Repo List
// Reverted to simple list for stability
// import * as ReactWindow from "react-window";
// import { AutoSizer } from "react-virtualized-auto-sizer";
import { EmptyState } from "../components/EmptyState";

// Fix for react-window v2 exports mismatch (List vs FixedSizeList)
// const FixedSizeList = (ReactWindow as any).List || (ReactWindow as any).FixedSizeList;

function RepoList({
  repos,
  loadingRepoId,
  onFetch,
  onRemove,
  selectedCategoryId,
  onRemoveFromCategory,
}: {
  repos: RepoWithSignals[];
  loadingRepoId: number | null;
  onFetch: (id: number) => void;
  onRemove: (id: number) => void;
  selectedCategoryId?: number | null;
  onRemoveFromCategory?: (categoryId: number, repoId: number) => void;
}) {
  return (
    <div className="repo-list-container" style={{ paddingBottom: 40 }}>
      {repos.map((repo) => (
        <div key={repo.id} style={{ marginBottom: 16 }}>
          <RepoCard
            repo={repo}
            onFetch={onFetch}
            onRemove={onRemove}
            isLoading={loadingRepoId === repo.id}
            selectedCategoryId={selectedCategoryId}
            onRemoveFromCategory={onRemoveFromCategory}
          />
        </div>
      ))}
    </div>
  );
}

// Error banner component
function ErrorBanner({ error, onClear }: { error: string; onClear: () => void }) {
  return (
    <div className="error-banner">
      {error}
      <button onClick={onClear}>x</button>
    </div>
  );
}

// Toolbar component
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
        title={t.watchlist.recalculateAll ?? "Recalculate Similarities"}
        aria-label={t.watchlist.recalculateAll ?? "Recalculate Similarities"}
      >
        {isRecalculating
          ? (t.watchlist.recalculating ?? "Calculating...")
          : (t.watchlist.recalculateAll ?? "Recalculate")}
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

// Main Watchlist component
export function Watchlist() {
  const { t } = useI18n();
  const {
    repos,
    displayedRepos,
    isLoading,
    isRefreshing,
    isRecalculatingSimilarities,
    loadingRepoId,
    error,
    isConnected,
    isDialogOpen,
    dialogError,
    isAddingRepo,
    selectedCategoryId,
    searchQuery,
    removeConfirm,
    toast,
    handleAddRepo,
    handleRemoveRepo,
    confirmRemoveRepo,
    cancelRemoveRepo,
    handleFetchRepo,
    handleRefreshAll,
    handleRecalculateAll,
    handleRetry,
    openAddDialog,
    closeAddDialog,
    clearError,
    setSelectedCategoryId,
    setSearchQuery,
  } = useWatchlist();

  // Category operations for add/remove repo from category
  const categoryOps = useCategoryOperations(() => {
    // Trigger re-selection to refresh the filtered list
    if (selectedCategoryId) {
      const current = selectedCategoryId;
      setSelectedCategoryId(null);
      setTimeout(() => setSelectedCategoryId(current), 0);
    }
  });

  const handleRemoveFromCategory = async (categoryId: number, repoId: number) => {
    const success = await categoryOps.removeFromCategory(categoryId, repoId);
    if (success) {
      toast.success(t.categories.removedFromCategory);
    } else {
      toast.error(t.toast.error);
    }
  };

  if (isLoading) {
    return <LoadingState />;
  }

  if (!isConnected) {
    return <ConnectionError onRetry={handleRetry} />;
  }

  return (
    <AnimatedPage className="page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.watchlist.title}</h1>
        <p className="subtitle">{t.watchlist.subtitle}</p>
      </header>

      <div className="watchlist-with-sidebar">
        <CategorySidebar
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={setSelectedCategoryId}
        />

        <div className="watchlist-main">
          <Toolbar
            onAddRepo={openAddDialog}
            onRefreshAll={handleRefreshAll}
            onRecalculateAll={handleRecalculateAll}
            isRefreshing={isRefreshing}
            isRecalculating={isRecalculatingSimilarities}
            selectedCategoryId={selectedCategoryId}
            displayedCount={displayedRepos.length}
            totalCount={repos.length}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />

          {error && <ErrorBanner error={error} onClear={clearError} />}

          <div className="repo-list" data-testid="repo-list">
            {displayedRepos.length === 0 ? (
              <div className="empty-state" data-testid="empty-state">
                <EmptyStateView
                  hasRepos={repos.length > 0}
                  hasSearch={searchQuery.trim().length > 0}
                  onAddRepo={openAddDialog}
                />
              </div>
            ) : (
              <RepoList
                repos={displayedRepos}
                loadingRepoId={loadingRepoId}
                onFetch={handleFetchRepo}
                onRemove={handleRemoveRepo}
                selectedCategoryId={selectedCategoryId}
                onRemoveFromCategory={handleRemoveFromCategory}
              />
            )}
          </div>
        </div>
      </div>

      <AddRepoDialog
        isOpen={isDialogOpen}
        onClose={closeAddDialog}
        onAdd={handleAddRepo}
        isLoading={isAddingRepo}
        error={dialogError}
      />

      <ConfirmDialog
        isOpen={removeConfirm.isOpen}
        title={t.dialog.removeRepo.title}
        message={interpolate(t.dialog.removeRepo.message, {
          name: removeConfirm.repoName,
        })}
        confirmText={t.dialog.removeRepo.confirm}
        variant="danger"
        onConfirm={confirmRemoveRepo}
        onCancel={cancelRemoveRepo}
      />

      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
    </AnimatedPage>
  );
}
