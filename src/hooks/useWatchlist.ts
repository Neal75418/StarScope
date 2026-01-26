/**
 * Custom hook for managing watchlist state and operations.
 * Composes smaller hooks for better separation of concerns.
 */

import { useEffect, useCallback, useRef } from "react";
import { useToast } from "../components/Toast";
import { useI18n } from "../i18n";
import { useConnection } from "./useConnection";
import { useRepoOperations } from "./useRepoOperations";
import { useCategoryFilter } from "./useCategoryFilter";
import { useAddRepoDialog } from "./useAddRepoDialog";
import { useRemoveConfirm } from "./useRemoveConfirm";
import { useGlobalRepoActions } from "./useGlobalRepoActions";

export function useWatchlist() {
  const { t } = useI18n();
  const toast = useToast();

  // Compose smaller hooks
  const connection = useConnection();
  const repoOps = useRepoOperations();
  const categoryFilter = useCategoryFilter(repoOps.repos);

  // Dialogs
  const addDialog = useAddRepoDialog(repoOps.addNewRepo, t.toast.error);
  const removeDialog = useRemoveConfirm(repoOps.repos, repoOps.deleteRepo, toast, {
    success: t.toast.repoRemoved,
    error: t.toast.error,
  });

  // Global Actions (Auto-tag, Recalculate)
  const globalActions = useGlobalRepoActions(toast);

  // Prevent duplicate fetches from StrictMode
  const hasInitializedRef = useRef(false);

  // Initial load
  useEffect(() => {
    // Skip if already initialized (prevents StrictMode double-fetch)
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    const init = async () => {
      repoOps.setIsLoading(true);
      const connected = await connection.checkConnection();
      if (connected) {
        await repoOps.loadRepos();
      }
      repoOps.setIsLoading(false);
    };
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retry connection
  const handleRetry = useCallback(async () => {
    repoOps.setIsLoading(true);
    repoOps.setError(null);
    const connected = await connection.checkConnection();
    if (connected) {
      await repoOps.loadRepos();
    }
    repoOps.setIsLoading(false);
  }, [connection, repoOps]);

  return {
    // State
    repos: repoOps.repos,
    displayedRepos: categoryFilter.displayedRepos,
    isLoading: repoOps.isLoading,
    isRefreshing: repoOps.isRefreshing,
    loadingRepoId: repoOps.loadingRepoId,
    error: repoOps.error || connection.connectionError,
    isConnected: connection.isConnected,
    isDialogOpen: addDialog.isDialogOpen,
    dialogError: addDialog.dialogError,
    isAddingRepo: addDialog.isAddingRepo,
    selectedCategoryId: categoryFilter.selectedCategoryId,
    searchQuery: categoryFilter.searchQuery,
    removeConfirm: removeDialog.removeConfirm,
    toast,

    // Global Action State
    isAutoTagging: globalActions.isAutoTagging,
    isRecalculatingSimilarities: globalActions.isRecalculatingSimilarities,

    // Actions
    handleAddRepo: addDialog.handleAddRepo,
    handleRemoveRepo: removeDialog.openRemoveConfirm,
    confirmRemoveRepo: removeDialog.confirmRemoveRepo,
    cancelRemoveRepo: removeDialog.closeRemoveConfirm,
    handleFetchRepo: repoOps.refreshRepo,
    handleRefreshAll: repoOps.refreshAllRepos,
    handleAutoTagAll: globalActions.handleAutoTagAll,
    handleRecalculateAll: globalActions.handleRecalculateAll,
    handleRetry,
    openAddDialog: addDialog.openAddDialog,
    closeAddDialog: addDialog.closeAddDialog,
    clearError: useCallback(() => repoOps.setError(null), [repoOps]),
    setSelectedCategoryId: categoryFilter.setSelectedCategoryId,
    setSearchQuery: categoryFilter.setSearchQuery,
  };
}
