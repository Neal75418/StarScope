/**
 * Custom hook for managing watchlist state and operations.
 * Composes smaller hooks for better separation of concerns.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "../components/Toast";
import { useI18n } from "../i18n";
import { useConnection } from "./useConnection";
import { useRepoOperations } from "./useRepoOperations";
import { useCategoryFilter } from "./useCategoryFilter";
import { useAddRepoDialog } from "./useAddRepoDialog";
import { useRemoveConfirm } from "./useRemoveConfirm";
import { autoTagAllRepos, recalculateAllSimilarities } from "../api/client";

export function useWatchlist() {
  const { t } = useI18n();
  const toast = useToast();
  const [isAutoTagging, setIsAutoTagging] = useState(false);
  const [isRecalculatingSimilarities, setIsRecalculatingSimilarities] = useState(false);

  // Compose smaller hooks
  const connection = useConnection();
  const repoOps = useRepoOperations();
  const categoryFilter = useCategoryFilter(repoOps.repos);
  const addDialog = useAddRepoDialog(repoOps.addNewRepo, t.toast.error);
  const removeDialog = useRemoveConfirm(
    repoOps.repos,
    repoOps.deleteRepo,
    toast,
    { success: t.toast.repoRemoved, error: t.toast.error }
  );

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

  // Auto-tag all repos
  const handleAutoTagAll = useCallback(async () => {
    setIsAutoTagging(true);
    try {
      const result = await autoTagAllRepos();
      toast.success(
        t.watchlist.autoTagComplete
          ? t.watchlist.autoTagComplete
              .replace("{repos}", String(result.repos_tagged))
              .replace("{tags}", String(result.tags_applied))
          : `Tagged ${result.repos_tagged} repos with ${result.tags_applied} tags`
      );
    } catch (err) {
      console.error("Failed to auto-tag repos:", err);
      toast.error(t.toast.error);
    } finally {
      setIsAutoTagging(false);
    }
  }, [toast, t]);

  // Recalculate all similarities
  const handleRecalculateAll = useCallback(async () => {
    setIsRecalculatingSimilarities(true);
    try {
      const result = await recalculateAllSimilarities();
      toast.success(
        t.watchlist.recalculateComplete
          ? t.watchlist.recalculateComplete
              .replace("{repos}", String(result.processed))
              .replace("{similarities}", String(result.similarities_found))
          : `Processed ${result.processed} repos, found ${result.similarities_found} similarities`
      );
    } catch (err) {
      console.error("Failed to recalculate similarities:", err);
      toast.error(t.toast.error);
    } finally {
      setIsRecalculatingSimilarities(false);
    }
  }, [toast, t]);

  return {
    // State
    repos: repoOps.repos,
    displayedRepos: categoryFilter.displayedRepos,
    isLoading: repoOps.isLoading,
    isRefreshing: repoOps.isRefreshing,
    isAutoTagging,
    isRecalculatingSimilarities,
    loadingRepoId: repoOps.loadingRepoId,
    error: repoOps.error || connection.connectionError,
    isConnected: connection.isConnected,
    isDialogOpen: addDialog.isDialogOpen,
    dialogError: addDialog.dialogError,
    isAddingRepo: addDialog.isAddingRepo,
    selectedCategoryId: categoryFilter.selectedCategoryId,
    removeConfirm: removeDialog.removeConfirm,
    toast,

    // Actions
    handleAddRepo: addDialog.handleAddRepo,
    handleRemoveRepo: removeDialog.openRemoveConfirm,
    confirmRemoveRepo: removeDialog.confirmRemoveRepo,
    cancelRemoveRepo: removeDialog.closeRemoveConfirm,
    handleFetchRepo: repoOps.refreshRepo,
    handleRefreshAll: repoOps.refreshAllRepos,
    handleAutoTagAll,
    handleRecalculateAll,
    handleRetry,
    openAddDialog: addDialog.openAddDialog,
    closeAddDialog: addDialog.closeAddDialog,
    clearError: useCallback(() => repoOps.setError(null), [repoOps]),
    setSelectedCategoryId: categoryFilter.setSelectedCategoryId,
  };
}
