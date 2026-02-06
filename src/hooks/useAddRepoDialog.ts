/**
 * 新增 Repo 對話框狀態與操作管理。
 */

import { useState, useCallback } from "react";

type AddRepoFn = (input: string) => Promise<{ success: boolean; error?: string }>;

export function useAddRepoDialog(addNewRepo: AddRepoFn, fallbackError: string) {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);

  const close = useCallback(() => {
    setIsOpen(false);
    setError(null);
  }, []);

  const handleAdd = useCallback(
    async (input: string) => {
      setIsAdding(true);
      setError(null);

      const result = await addNewRepo(input);

      if (result.success) {
        close();
      } else {
        setError(result.error || fallbackError);
      }

      setIsAdding(false);
    },
    [addNewRepo, fallbackError, close]
  );

  return {
    isDialogOpen: isOpen,
    dialogError: error,
    isAddingRepo: isAdding,
    openAddDialog: open,
    closeAddDialog: close,
    handleAddRepo: handleAdd,
  };
}
