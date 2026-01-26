/**
 * Hook for managing delete confirmation dialog state.
 */

import { useState, useCallback } from "react";

interface DeleteConfirmState {
  isOpen: boolean;
  itemId: number | null;
}

export function useDeleteConfirm() {
  const [state, setState] = useState<DeleteConfirmState>({
    isOpen: false,
    itemId: null,
  });

  const open = useCallback((id: number) => {
    setState({ isOpen: true, itemId: id });
  }, []);

  const close = useCallback(() => {
    setState({ isOpen: false, itemId: null });
  }, []);

  return {
    isOpen: state.isOpen,
    itemId: state.itemId,
    open,
    close,
  };
}
