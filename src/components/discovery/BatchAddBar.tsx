/**
 * 批次加入 watchlist 的操作列，固定在結果區域底部。
 */

import { useState, useCallback, useRef, useEffect, memo } from "react";
import { batchAddRepos } from "../../api/client";
import { ApiError } from "../../api/types";
import { invalidateTrackedRepos, keepRefetchingAfterTimeout } from "../../lib/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { interpolate, useI18n } from "../../i18n";
import { describeWriteFailure, isRequestTimeout } from "../../utils/writeFailure";
import { useToast } from "../Toast";
import styles from "./Discovery.module.css";

interface BatchAddBarProps {
  selectedRepos: { owner: string; name: string }[];
  selectedCount: number;
  onDone: () => void;
}

export const BatchAddBar = memo(function BatchAddBar({
  selectedRepos,
  selectedCount,
  onDone,
}: BatchAddBarProps) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const handleBatchAdd = useCallback(async () => {
    if (isAdding || selectedRepos.length === 0) return;
    setIsAdding(true);
    try {
      const { success: added, skipped, failed, total } = await batchAddRepos(selectedRepos);
      if (failed === 0) {
        // 沒有失敗的就算完成、退出 selection mode：本來就在追蹤清單的（skipped）不是失敗
        if (added === 0) {
          toast.info(t.discovery.batchAdd.allTracked);
        } else if (skipped > 0) {
          toast.success(
            interpolate(t.discovery.batchAdd.addedSomeTracked, { count: added, skipped })
          );
        } else {
          toast.success(interpolate(t.discovery.batchAdd.added, { count: added }));
        }
        invalidateTrackedRepos(queryClient);
        onDone();
      } else if (failed < total) {
        // 有幾個沒加入 — 保留 selection 讓使用者可重試（已加入的重送時後端會略過、算在 skipped）。
        // 有 skipped 時三個數字都列出來：重試那一次 added 常常是 0，只說「已加入 0 個」交代不了其餘的去向
        toast.warning(
          skipped > 0
            ? interpolate(t.discovery.batchAdd.partialSomeTracked, {
                count: added,
                skipped,
                failed,
              })
            : interpolate(t.discovery.batchAdd.partial, { count: added, failed })
        );
        invalidateTrackedRepos(queryClient);
      } else {
        toast.error(interpolate(t.discovery.batchAdd.allFailed, { count: total }));
      }
    } catch (err) {
      // 逾時＝伺服器還在逐筆加入（做完會立刻回應，client 斷線也不會讓它停下），說「發生錯誤」會讓人以為沒加入；
      // 其他失敗也可能已經加了前面幾筆，名單一律重抓
      if (isRequestTimeout(err)) {
        toast.info(t.discovery.batchAdd.stillProcessing);
        // 計時器不跟著元件卸載清掉：提示叫使用者去追蹤清單看，一離開探索頁這個元件就卸載了；
        // queryClient 跟 app 同壽命，卸載後重抓照樣有效
        keepRefetchingAfterTimeout(() => invalidateTrackedRepos(queryClient));
      } else {
        // 4xx 是請求被擋在門口（節流、格式不對），伺服器一筆都沒處理；其餘的不確定做到哪裡
        const rejectedUpFront = err instanceof ApiError && err.status >= 400 && err.status < 500;
        toast.error(
          describeWriteFailure(err, t, {
            notDone: rejectedUpFront
              ? t.discovery.addFailed.notDone
              : t.discovery.batchAdd.interrupted,
            timedOut: t.discovery.batchAdd.stillProcessing,
          })
        );
      }
      invalidateTrackedRepos(queryClient);
    } finally {
      if (mountedRef.current) setIsAdding(false);
    }
  }, [isAdding, selectedRepos, toast, t, queryClient, onDone]);

  if (selectedCount === 0) return null;

  return (
    <div className={styles.batchAddBar}>
      <span className={styles.batchAddCount}>
        {t.discovery.batchAdd.selected.replace("{count}", String(selectedCount))}
      </span>
      <button className={styles.batchAddButton} onClick={handleBatchAdd} disabled={isAdding}>
        {isAdding
          ? t.discovery.batchAdd.adding
          : t.discovery.batchAdd.addToWatchlist.replace("{count}", String(selectedCount))}
      </button>
    </div>
  );
});
