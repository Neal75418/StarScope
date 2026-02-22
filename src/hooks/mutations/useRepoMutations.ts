/**
 * Repo 寫入操作的 React Query mutation hooks。
 *
 * 提供 addRepo / removeRepo / fetchRepo / refreshAll 四個 mutation，
 * 成功時自動 invalidate repos 快取，讓 useReposQuery 重新取得最新資料。
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addRepo, removeRepo, fetchRepo, fetchAllRepos } from "../../api/client";
import type { RepoCreate, RepoWithSignals } from "../../api/types";
import { queryKeys } from "../../lib/react-query";

/**
 * 新增 repo 至追蹤清單。
 *
 * 成功後 invalidate repos 快取，觸發列表自動更新。
 */
export function useAddRepoMutation() {
  const qc = useQueryClient();

  return useMutation<RepoWithSignals, Error, RepoCreate>({
    mutationFn: addRepo,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.repos.all });
    },
  });
}

/**
 * 從追蹤清單移除 repo。
 *
 * 成功後 invalidate repos 快取。
 */
export function useRemoveRepoMutation() {
  const qc = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: removeRepo,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.repos.all });
    },
  });
}

/**
 * 手動觸發單一 repo 資料更新。
 *
 * 成功後 invalidate repos 快取，讓列表反映最新數值。
 */
export function useFetchRepoMutation() {
  const qc = useQueryClient();

  return useMutation<RepoWithSignals, Error, number>({
    mutationFn: fetchRepo,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.repos.all });
    },
  });
}

/**
 * 批次更新所有 repos 的最新資料。
 *
 * 成功後 invalidate repos 快取。
 */
export function useRefreshAllMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: fetchAllRepos,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.repos.all });
    },
  });
}
