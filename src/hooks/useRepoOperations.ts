/**
 * Hook for managing repository CRUD operations.
 * Composes state and mutation hooks.
 */

import { useCallback, useMemo } from "react";
import { getRepos, ApiError } from "../api/client";
import { useI18n } from "../i18n";
import { useRepoState } from "./useRepoState";
import { useRepoMutations } from "./useRepoMutations";

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.detail : fallback;
}

export function useRepoOperations() {
  const { t } = useI18n();
  const state = useRepoState();

  const mutationDeps = useMemo(
    () => ({
      setRepos: state.setRepos,
      setError: state.setError,
      setLoadingRepoId: state.setLoadingRepoId,
      setIsRefreshing: state.setIsRefreshing,
      errorMsg: t.common.error,
      invalidFormatMsg: t.dialog.addRepo.invalidFormat,
    }),
    [state, t.common.error, t.dialog.addRepo.invalidFormat]
  );

  const mutations = useRepoMutations(mutationDeps);

  const loadRepos = useCallback(async () => {
    try {
      const response = await getRepos();
      state.setRepos(response.repos);
      state.setError(null);
    } catch (err) {
      state.setError(getErrorMessage(err, t.common.error));
    }
  }, [state, t.common.error]);

  return {
    ...state,
    loadRepos,
    ...mutations,
  };
}
