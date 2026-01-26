/**
 * Hook for compare group CRUD operations.
 */

import { useCallback } from "react";
import {
  ComparisonGroupDetail,
  createComparisonGroup,
  updateComparisonGroup,
  deleteComparisonGroup,
  removeRepoFromComparison,
} from "../api/client";
import { getErrorMessage } from "../utils/error";
import { useI18n } from "../i18n";

interface Toast {
  success: (msg: string) => void;
  error: (msg: string) => void;
}

interface UseCompareOperationsOptions {
  toast: Toast;
  selectedGroup: ComparisonGroupDetail | null;
  onGroupsChanged: () => Promise<void>;
  onGroupDetailChanged: (groupId: number) => Promise<void>;
  onSelectedGroupCleared: () => void;
}

export function useCompareOperations({
  toast,
  selectedGroup,
  onGroupsChanged,
  onGroupDetailChanged,
  onSelectedGroupCleared,
}: UseCompareOperationsOptions) {
  const { t } = useI18n();

  const handleCreateGroup = useCallback(
    async (name: string, description?: string): Promise<boolean> => {
      try {
        await createComparisonGroup(name, description);
        toast.success(t.compare.toast.groupCreated);
        await onGroupsChanged();
        return true;
      } catch (err) {
        toast.error(getErrorMessage(err, t.compare.loadingError));
        return false;
      }
    },
    [onGroupsChanged, toast, t]
  );

  const handleUpdateGroup = useCallback(
    async (groupId: number, name: string, description?: string): Promise<boolean> => {
      try {
        await updateComparisonGroup(groupId, { name, description });
        toast.success(t.compare.toast.groupUpdated);
        await onGroupsChanged();
        return true;
      } catch (err) {
        toast.error(getErrorMessage(err, t.compare.loadingError));
        return false;
      }
    },
    [onGroupsChanged, toast, t]
  );

  const handleDeleteGroup = useCallback(
    async (groupId: number): Promise<void> => {
      try {
        await deleteComparisonGroup(groupId);
        if (selectedGroup?.group_id === groupId) {
          onSelectedGroupCleared();
        }
        toast.success(t.compare.toast.groupDeleted);
        await onGroupsChanged();
      } catch (err) {
        toast.error(getErrorMessage(err, t.compare.loadingError));
      }
    },
    [selectedGroup, onGroupsChanged, onSelectedGroupCleared, toast, t]
  );

  const handleRemoveRepo = useCallback(
    async (repoId: number): Promise<void> => {
      if (!selectedGroup) return;

      try {
        await removeRepoFromComparison(selectedGroup.group_id, repoId);
        await onGroupDetailChanged(selectedGroup.group_id);
      } catch (err) {
        toast.error(getErrorMessage(err, t.compare.loadingError));
      }
    },
    [selectedGroup, onGroupDetailChanged, toast, t]
  );

  return {
    handleCreateGroup,
    handleUpdateGroup,
    handleDeleteGroup,
    handleRemoveRepo,
  };
}
