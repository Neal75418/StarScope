/**
 * Star 同步：讀狀態 + 手動觸發。
 *
 * 不在這裡自動觸發：sidecar 啟動時已經同步過一次（見 main.py 的 lifespan），
 * 前端再自動打一次只會拿到 already_running。這顆按鈕是給「剛在 github.com 上
 * 改了 star、不想關掉 app」的情況用的。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSyncStatus, resolveLocalOnly, syncStars } from "../api/client";
import { queryKeys } from "../lib/react-query";

export function useStarSync() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: queryKeys.repos.syncStatus(),
    queryFn: ({ signal }) => getSyncStatus(signal),
  });

  const mutation = useMutation({
    mutationFn: () => syncStars(),
    onSuccess: () => {
      // 同步會新增、封存與復原 repo，追蹤清單與封存清單都要重取；
      // 用 repos.all 當前綴一次涵蓋，避免日後新增查詢時漏掉
      void queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
    },
  });

  // 首次同步列出的待決 repo：處理完就從清單消失，所以連同 mutation 結果一起失效
  const resolve = useMutation({
    mutationFn: ({ action, fullNames }: { action: "star" | "archive"; fullNames: string[] }) =>
      resolveLocalOnly(action, fullNames),
    onSuccess: () => {
      mutation.reset();
      void queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
    },
  });

  return {
    status: statusQuery.data ?? null,
    isStatusLoading: statusQuery.isLoading,
    resolve: (action: "star" | "archive", fullNames: string[]) =>
      resolve.mutateAsync({ action, fullNames }),
    isResolving: resolve.isPending,
    sync: () => mutation.mutateAsync(),
    isSyncing: mutation.isPending,
    lastResult: mutation.data ?? null,
    error: mutation.error,
  };
}
