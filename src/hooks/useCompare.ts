/**
 * Hook for managing compare page state and operations.
 * Composes useDeleteConfirm and useCompareOperations for reduced complexity.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ComparisonGroup,
  ComparisonGroupDetail,
  listComparisonGroups,
  getComparisonGroup,
} from "../api/client";
import { getErrorMessage } from "../utils/error";
import { useI18n } from "../i18n";
import { useDeleteConfirm } from "./useDeleteConfirm";
import { useCompareOperations } from "./useCompareOperations";

interface Toast {
  success: (msg: string) => void;
  error: (msg: string) => void;
}

export function useCompare(toast: Toast) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<ComparisonGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ComparisonGroupDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const deleteConfirm = useDeleteConfirm();

  // Prevent duplicate fetches from StrictMode
  const hasFetchedRef = useRef(false);

  const loadGroups = useCallback(async () => {
    try {
      const response = await listComparisonGroups();
      setGroups(response.groups);
    } catch (err) {
      toast.error(getErrorMessage(err, t.compare.loadingError));
    }
  }, [toast, t]);

  const loadGroupDetail = useCallback(
    async (groupId: number) => {
      try {
        const detail = await getComparisonGroup(groupId);
        setSelectedGroup(detail);
      } catch (err) {
        toast.error(getErrorMessage(err, t.compare.loadingError));
      }
    },
    [toast, t]
  );

  useEffect(() => {
    // Skip if already fetched (prevents StrictMode double-fetch)
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    setIsLoading(true);
    loadGroups().finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const operations = useCompareOperations({
    toast,
    selectedGroup,
    onGroupsChanged: loadGroups,
    onGroupDetailChanged: loadGroupDetail,
    onSelectedGroupCleared: () => setSelectedGroup(null),
  });

  const confirmDeleteGroup = useCallback(async () => {
    if (!deleteConfirm.itemId) return;
    await operations.handleDeleteGroup(deleteConfirm.itemId);
    deleteConfirm.close();
  }, [deleteConfirm, operations]);

  return {
    groups,
    selectedGroup,
    isLoading,
    deleteConfirm: {
      isOpen: deleteConfirm.isOpen,
      groupId: deleteConfirm.itemId,
      open: deleteConfirm.open,
      close: deleteConfirm.close,
    },
    loadGroupDetail,
    handleCreateGroup: operations.handleCreateGroup,
    handleUpdateGroup: operations.handleUpdateGroup,
    confirmDeleteGroup,
    handleRemoveRepo: operations.handleRemoveRepo,
  };
}
