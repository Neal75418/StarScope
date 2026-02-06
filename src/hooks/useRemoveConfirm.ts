/**
 * 移除確認對話框狀態與操作管理。
 */

import { useState, useCallback } from "react";
import { RepoWithSignals } from "../api/client";

interface RemoveConfirmState {
  isOpen: boolean;
  repoId: number | null;
  repoName: string;
}

const initialState: RemoveConfirmState = {
  isOpen: false,
  repoId: null,
  repoName: "",
};

type DeleteRepoFn = (repoId: number) => Promise<boolean>;
type ToastFn = { success: (msg: string) => void; error: (msg: string) => void };

export function useRemoveConfirm(
  repos: RepoWithSignals[],
  deleteRepo: DeleteRepoFn,
  toast: ToastFn,
  messages: { success: string; error: string }
) {
  const [state, setState] = useState<RemoveConfirmState>(initialState);

  const open = useCallback(
    (repoId: number) => {
      const repo = repos.find((r) => r.id === repoId);
      setState({
        isOpen: true,
        repoId,
        repoName: repo?.full_name || "",
      });
    },
    [repos]
  );

  const close = useCallback(() => {
    setState(initialState);
  }, []);

  const confirm = useCallback(async () => {
    if (!state.repoId) return;

    const success = await deleteRepo(state.repoId);
    if (success) {
      toast.success(messages.success);
    } else {
      toast.error(messages.error);
    }
    close();
  }, [state.repoId, deleteRepo, toast, messages, close]);

  return {
    removeConfirm: state,
    openRemoveConfirm: open,
    closeRemoveConfirm: close,
    confirmRemoveRepo: confirm,
  };
}
