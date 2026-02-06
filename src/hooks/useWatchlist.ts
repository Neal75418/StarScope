/**
 * Watchlist 狀態與操作管理，組合多個小型 hooks。
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

  // 組合各功能 hooks
  const connection = useConnection();
  const repoOps = useRepoOperations();
  const categoryFilter = useCategoryFilter(repoOps.repos);

  // 對話框
  const addDialog = useAddRepoDialog(repoOps.addNewRepo, t.toast.error);
  const removeDialog = useRemoveConfirm(repoOps.repos, repoOps.deleteRepo, toast, {
    success: t.toast.repoRemoved,
    error: t.toast.error,
  });

  // 全域操作（重新計算等）
  const globalActions = useGlobalRepoActions(toast);

  // 避免 StrictMode 重複請求
  const hasInitializedRef = useRef(false);

  // 初始載入
  useEffect(() => {
    // 已初始化則跳過（防止 StrictMode 雙重觸發）
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

  // 重試連線
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
    // 狀態
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

    // 全域操作狀態
    isRecalculatingSimilarities: globalActions.isRecalculatingSimilarities,

    // 操作
    handleAddRepo: addDialog.handleAddRepo,
    handleRemoveRepo: removeDialog.openRemoveConfirm,
    confirmRemoveRepo: removeDialog.confirmRemoveRepo,
    cancelRemoveRepo: removeDialog.closeRemoveConfirm,
    handleFetchRepo: repoOps.refreshRepo,
    handleRefreshAll: repoOps.refreshAllRepos,
    handleRecalculateAll: globalActions.handleRecalculateAll,
    handleRetry,
    openAddDialog: addDialog.openAddDialog,
    closeAddDialog: addDialog.closeAddDialog,
    clearError: useCallback(() => repoOps.setError(null), [repoOps]),
    setSelectedCategoryId: categoryFilter.setSelectedCategoryId,
    setSearchQuery: categoryFilter.setSearchQuery,
  };
}
