/**
 * 發現背景完成的星標同步。
 *
 * sidecar 啟動時的同步與 launchd 收集器每小時一次的同步都不會通知前端，GitHub 上的 star／取消 star
 * 因此不會反映到畫面上。這裡每分鐘看一次最後同步時間（頁面隱藏或離線時暫停），跟上次看到的不同
 * 就重取追蹤名單，分類與警報規則跟著重讀（見 invalidateTrackedRepos）。
 * 第一次讀到的值只當基準：開 app 時資料本來就是剛抓的。
 */

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSyncStatus } from "../api/client";
import { STAR_SYNC_POLL_INTERVAL_MS } from "../constants/polling";
import { invalidateTrackedRepos, queryKeys } from "../lib/react-query";
import { useSmartInterval } from "./useSmartInterval";

export function useBackgroundStarSync(enabled: boolean): void {
  const qc = useQueryClient();
  const interval = useSmartInterval(STAR_SYNC_POLL_INTERVAL_MS);
  const { data } = useQuery({
    queryKey: queryKeys.repos.syncStatus(),
    queryFn: ({ signal }) => getSyncStatus(signal),
    enabled,
    refetchInterval: interval,
  });

  // undefined＝還沒讀到；null＝從沒同步過（之後變成有值同樣算一次新的同步）
  const lastSyncAt = data === undefined ? undefined : data.last_sync_at;
  const seenRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (lastSyncAt === undefined) return;
    const seen = seenRef.current;
    seenRef.current = lastSyncAt;
    // 直接比字串，不解析時間：只在乎「變了沒」。同一個值不會讓 effect 重跑，所以重取時重讀到
    // 同一個值（key 在 repos 底下）不會繞圈；比較是給「重設所有資料」清掉快取、資料先變 undefined
    // 再讀回同一個值的情況，那不是新的同步
    if (seen !== undefined && seen !== lastSyncAt) invalidateTrackedRepos(qc);
  }, [lastSyncAt, qc]);
}
