/**
 * Repository 變更操作（新增、刪除、重新整理）。
 */

import { useCallback, Dispatch, SetStateAction } from "react";
import {
  RepoWithSignals,
  addRepo,
  removeRepo,
  fetchRepo,
  fetchAllRepos,
  ApiError,
} from "../api/client";

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.detail : fallback;
}

function parseRepoInput(input: string): { owner?: string; name?: string; url?: string } | null {
  if (input.includes("github.com")) return { url: input };
  if (input.includes("/")) {
    const parts = input.split("/");
    // 確保恰好有 2 個部分（owner/name）
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return null;
    }
    return { owner: parts[0], name: parts[1] };
  }
  return null;
}

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
      const repoInput = parseRepoInput(input);
      if (!repoInput) {
        return { success: false, error: deps.invalidFormatMsg };
      }
      try {
        const newRepo = await addRepo(repoInput);
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
