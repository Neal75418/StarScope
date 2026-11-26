/**
 * 發現背景完成的星標同步與抓取。
 *
 * sidecar 啟動時的同步、launchd 收集器每小時一次的同步，以及排程與收集器的抓取都不會通知前端，GitHub 上的
 * star／取消 star 與新的星數因此不會反映到畫面上。這裡每分鐘看一次最後同步時間與最新快照的寫入時間（頁面隱藏
 * 或離線時暫停），跟上次看到的不同就重取追蹤名單（分類、訊號、警報規則與已觸發警報跟著重讀，見 invalidateTrackedRepos）
 * 與儀表板。
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

  // undefined＝還沒讀到；null＝從沒同步過（之後變成有值同樣算一次新的同步）。
  // 最新快照的寫入時間一起看：背景抓取（排程、收集器）也不會通知前端，沒有同步時最後同步時間不會變
  const lastChange =
    data === undefined ? undefined : `${data.last_sync_at ?? ""}|${data.last_snapshot_at ?? ""}`;
  const seenRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastChange === undefined) return;
    const seen = seenRef.current;
    seenRef.current = lastChange;
    // 直接比字串，不解析時間：只在乎「變了沒」。比較是給「重設所有資料」清掉快取、資料先變 undefined
    // 再讀回同一個值的情況，那不是新的同步（重設把快照刪光時，值從有變成沒有，算一次變化：重讀的都是重設後的請求，無害）
    if (seen !== undefined && seen !== lastChange) {
      // 同步狀態的 key 也在 repos 底下：跟著重讀的話，抓取（排程、收集器、全部重新整理）還在逐筆寫快照時，
      // 每次都讀到新的快照時間、又觸發一次，一路連到寫完。不重讀它，寫入期間的最後一個值由下一輪輪詢接到
      invalidateTrackedRepos(qc, { exceptSyncStatus: true });
      // 儀表板「最後更新」的標籤（後端最後一次抓取的時間），以及也從快照算的週摘要與每日 star
      void qc.invalidateQueries({ queryKey: [...queryKeys.connection.all, "diagnostics"] });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    }
  }, [lastChange, qc]);
}
