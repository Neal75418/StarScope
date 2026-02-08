/**
 * Repository 變更操作（新增、刪除、重新整理）。
 */

import { useCallback, Dispatch, SetStateAction } from "react";
import { RepoWithSignals, addRepo, removeRepo, fetchRepo, fetchAllRepos } from "../api/client";
import { getErrorMessage } from "../utils/error";
import { parseRepoString } from "../utils/importHelpers";

interface MutationDeps {
  setRepos: Dispatch<SetStateAction<RepoWithSignals[]>>;
  setError: (error: string | null) => void;
  setLoadingRepoId: (id: number | null) => void;
  setIsRefreshing: (val: boolean) => void;
  errorMsg: string;
  invalidFormatMsg: string;
}

export function useRepoMutations(deps: MutationDeps) {
  const addNewRepo = useCallback(
    async (input: string): Promise<{ success: boolean; error?: string }> => {
      const parsed = parseRepoString(input);
      if (!parsed) {
        return { success: false, error: deps.invalidFormatMsg };
      }
      try {
        const newRepo = await addRepo({ owner: parsed.owner, name: parsed.name });
        deps.setRepos((prev) => [newRepo, ...prev]);
        return { success: true };
      } catch (err) {
        return { success: false, error: getErrorMessage(err, deps.errorMsg) };
      }
    },
    [deps]
  );

  const deleteRepo = useCallback(
    async (repoId: number): Promise<boolean> => {
      deps.setLoadingRepoId(repoId);
      try {
        await removeRepo(repoId);
        deps.setRepos((prev) => prev.filter((r) => r.id !== repoId));
        return true;
      } catch (err) {
        deps.setError(getErrorMessage(err, deps.errorMsg));
        return false;
      } finally {
        deps.setLoadingRepoId(null);
      }
    },
    [deps]
  );

  const refreshRepo = useCallback(
    async (repoId: number): Promise<void> => {
      deps.setLoadingRepoId(repoId);
      try {
        const updated = await fetchRepo(repoId);
        deps.setRepos((prev) => prev.map((r) => (r.id === repoId ? updated : r)));
      } catch (err) {
        deps.setError(getErrorMessage(err, deps.errorMsg));
      } finally {
        deps.setLoadingRepoId(null);
      }
    },
    [deps]
  );

  const refreshAllRepos = useCallback(async (): Promise<void> => {
    deps.setIsRefreshing(true);
    try {
      const response = await fetchAllRepos();
      deps.setRepos(response.repos);
      deps.setError(null);
    } catch (err) {
      deps.setError(getErrorMessage(err, deps.errorMsg));
    } finally {
      deps.setIsRefreshing(false);
    }
  }, [deps]);

  return { addNewRepo, deleteRepo, refreshRepo, refreshAllRepos };
}
