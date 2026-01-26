/**
 * Watchlist page - main view showing all tracked repositories.
 */

import { RepoCard } from "../components/RepoCard";
import { AddRepoDialog } from "../components/AddRepoDialog";
import { CategorySidebar } from "../components/CategorySidebar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
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
function EmptyState({
  hasCategory,
  hasRepos,
}: {
  hasCategory: boolean;
  hasRepos: boolean;
}) {
  const { t } = useI18n();

  if (hasCategory) {
    return <p>{t.watchlist.empty.noCategory}</p>;
  }
  if (!hasRepos) {
    return (
      <>
        <p>{t.watchlist.empty.noRepos}</p>
        <p>{t.watchlist.empty.addPrompt}</p>
      </>
    );
  }
  return <p>{t.watchlist.empty.noFilter}</p>;
}

// Repo list component
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
    <>
      {repos.map((repo) => (
        <RepoCard
          key={repo.id}
          repo={repo}
          onFetch={onFetch}
          onRemove={onRemove}
          isLoading={loadingRepoId === repo.id}
          selectedCategoryId={selectedCategoryId}
          onRemoveFromCategory={onRemoveFromCategory}
        />
      ))}
    </>
  );
}

// Error banner component
function ErrorBanner({
  error,
  onClear,
}: {
  error: string;
  onClear: () => void;
}) {
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
  onAutoTagAll,
  onRecalculateAll,
  isRefreshing,
  isAutoTagging,
  isRecalculating,
  selectedCategoryId,
  displayedCount,
  totalCount,
}: {
  onAddRepo: () => void;
  onRefreshAll: () => void;
  onAutoTagAll: () => void;
  onRecalculateAll: () => void;
  isRefreshing: boolean;
  isAutoTagging: boolean;
  isRecalculating: boolean;
  selectedCategoryId: number | null;
  displayedCount: number;
  totalCount: number;
}) {
  const { t } = useI18n();

  return (
    <div className="toolbar">
      <button
        data-testid="add-repo-btn"
        onClick={onAddRepo}
        className="btn btn-primary"
      >
        + {t.watchlist.addRepo}
      </button>
      <button
        data-testid="refresh-all-btn"
        onClick={onRefreshAll}
        disabled={isRefreshing}
        className="btn"
      >
        {isRefreshing ? t.watchlist.refreshing : t.watchlist.refreshAll}
      </button>
      <button
        onClick={onAutoTagAll}
        disabled={isAutoTagging}
        className="btn"
        title={t.watchlist.autoTagAll ?? "Auto-Tag All"}
      >
        {isAutoTagging
          ? t.watchlist.autoTagging ?? "Tagging..."
          : t.watchlist.autoTagAll ?? "Auto-Tag All"}
      </button>
      <button
        onClick={onRecalculateAll}
        disabled={isRecalculating}
        className="btn"
        title={t.watchlist.recalculateAll ?? "Recalculate Similarities"}
      >
        {isRecalculating
          ? t.watchlist.recalculating ?? "Calculating..."
          : t.watchlist.recalculateAll ?? "Recalculate"}
      </button>
      {selectedCategoryId && (
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
    isAutoTagging,
    isRecalculatingSimilarities,
    loadingRepoId,
    error,
    isConnected,
    isDialogOpen,
    dialogError,
    isAddingRepo,
    selectedCategoryId,
    removeConfirm,
    toast,
    handleAddRepo,
    handleRemoveRepo,
    confirmRemoveRepo,
    cancelRemoveRepo,
    handleFetchRepo,
    handleRefreshAll,
    handleAutoTagAll,
    handleRecalculateAll,
    handleRetry,
    openAddDialog,
    closeAddDialog,
    clearError,
    setSelectedCategoryId,
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
    <div className="page">
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
            onAutoTagAll={handleAutoTagAll}
            onRecalculateAll={handleRecalculateAll}
            isRefreshing={isRefreshing}
            isAutoTagging={isAutoTagging}
            isRecalculating={isRecalculatingSimilarities}
            selectedCategoryId={selectedCategoryId}
            displayedCount={displayedRepos.length}
            totalCount={repos.length}
          />

          {error && <ErrorBanner error={error} onClear={clearError} />}

          <div className="repo-list" data-testid="repo-list">
            {displayedRepos.length === 0 ? (
              <div className="empty-state" data-testid="empty-state">
                <EmptyState
                  hasCategory={selectedCategoryId !== null}
                  hasRepos={repos.length > 0}
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
    </div>
  );
}
