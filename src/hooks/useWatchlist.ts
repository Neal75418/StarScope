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
    // 核心狀態
    state: {
      repos: repoOps.repos,
      displayedRepos: categoryFilter.displayedRepos,
      isLoading: repoOps.isLoading,
      isRefreshing: repoOps.isRefreshing,
      loadingRepoId: repoOps.loadingRepoId,
      error: repoOps.error || connection.connectionError,
      isConnected: connection.isConnected,
      isRecalculatingSimilarities: globalActions.isRecalculatingSimilarities,
    },
    // 新增 Repo 對話框
    dialog: {
      isOpen: addDialog.isDialogOpen,
      error: addDialog.dialogError,
      isAdding: addDialog.isAddingRepo,
      open: addDialog.openAddDialog,
      close: addDialog.closeAddDialog,
      submit: addDialog.handleAddRepo,
    },
    // 分類篩選
    category: {
      selectedId: categoryFilter.selectedCategoryId,
      searchQuery: categoryFilter.searchQuery,
      setSelectedId: categoryFilter.setSelectedCategoryId,
      setSearchQuery: categoryFilter.setSearchQuery,
      refresh: categoryFilter.refreshCategory,
    },
    // 操作
    actions: {
      remove: removeDialog.openRemoveConfirm,
      confirmRemove: removeDialog.confirmRemoveRepo,
      cancelRemove: removeDialog.closeRemoveConfirm,
      fetchRepo: repoOps.refreshRepo,
      refreshAll: repoOps.refreshAllRepos,
      recalculateAll: globalActions.handleRecalculateAll,
      retry: handleRetry,
      clearError: useCallback(() => repoOps.setError(null), [repoOps]),
    },
    // 其它
    removeConfirm: removeDialog.removeConfirm,
    toast,
  };
}
