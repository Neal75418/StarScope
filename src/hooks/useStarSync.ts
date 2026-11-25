/**
 * Star 同步：讀狀態 + 手動觸發。
 *
 * 不在這裡自動觸發：sidecar 啟動時已經同步過一次（見 main.py 的 lifespan），
 * 前端再自動打一次只會拿到 already_running。這顆按鈕是給「剛在 github.com 上
 * 改了 star、不想關掉 app」的情況用的。
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSyncStatus, resolveLocalOnly, syncStars } from "../api/client";
import { DATA_RESET_EVENT } from "../constants/events";
import {
  invalidateTrackedRepos,
  loadStatus,
  queryKeys,
  resetUnlessRunning,
} from "../lib/react-query";
import { useInstanceMutationKey } from "./useInstanceMutationKey";

const SYNC_KEY = ["starSync", "sync"] as const;
const RESOLVE_KEY = ["starSync", "resolve"] as const;

export function useStarSync() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: queryKeys.repos.syncStatus(),
    queryFn: ({ signal }) => getSyncStatus(signal),
  });

  const syncKey = useInstanceMutationKey(SYNC_KEY);
  const resolveKey = useInstanceMutationKey(RESOLVE_KEY);

  const mutation = useMutation({
    mutationKey: syncKey,
    mutationFn: () => syncStars(),
    onSuccess: () => {
      // 同步會新增、封存與復原 repo，追蹤清單與封存清單都要重取（repos.all 前綴一次涵蓋，
      // 避免日後新增查詢時漏掉），綁在封存 repo 上的警報規則也跟著消失或回來
      invalidateTrackedRepos(queryClient);
    },
  });

  // 首次同步列出的待決 repo：處理完就從清單消失，所以連同 mutation 結果一起失效
  const resolve = useMutation({
    mutationKey: resolveKey,
    mutationFn: ({ action, fullNames }: { action: "star" | "archive"; fullNames: string[] }) =>
      resolveLocalOnly(action, fullNames),
    onSuccess: () => {
      // 清單動作做完，同步結果裡的待決清單就過期了；同步還在跑就不動（見 resetUnlessRunning）
      resetUnlessRunning(queryClient, syncKey, mutation.reset);
      invalidateTrackedRepos(queryClient);
    },
  });

  // 重設資料之後，上一次同步的計數與待決清單講的是已經刪掉的 repo（按「全部加到 GitHub」後端找不到就跳過）：
  // 同步與清單動作的結果一併清掉。結果存在 mutation 裡、不在查詢快取，重設時清快取碰不到；
  // 還在跑的不動（見 resetUnlessRunning）
  const resetSync = mutation.reset;
  const resetResolve = resolve.reset;
  useEffect(() => {
    const handler = () => {
      resetUnlessRunning(queryClient, syncKey, resetSync);
      resetUnlessRunning(queryClient, resolveKey, resetResolve);
    };
    window.addEventListener(DATA_RESET_EVENT, handler);
    return () => window.removeEventListener(DATA_RESET_EVENT, handler);
  }, [queryClient, syncKey, resolveKey, resetSync, resetResolve]);

  return {
    status: statusQuery.data ?? null,
    statusLoad: loadStatus(statusQuery),
    resolve: (action: "star" | "archive", fullNames: string[]) =>
      resolve.mutateAsync({ action, fullNames }),
    isResolving: resolve.isPending,
    sync: () => {
      // 重新同步時丟掉清單動作的舊錯誤（共用同一個錯誤區）
      resetUnlessRunning(queryClient, resolveKey, resolve.reset);
      return mutation.mutateAsync();
    },
    isSyncing: mutation.isPending,
    lastResult: mutation.data ?? null,
    // 處理「只在本機」清單的動作失敗也要說：畫面上共用同一個錯誤區，否則按了沒反應
    error: mutation.error ?? resolve.error,
  };
}
