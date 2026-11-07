/**
 * 批次加入 watchlist 的操作列，固定在結果區域底部。
 */

import { useState, useCallback, useRef, useEffect, memo } from "react";
import { batchAddRepos } from "../../api/client";
import { ApiError } from "../../api/types";
import {
  API_ERROR_MESSAGES,
  BATCH_ADD_FOLLOWUP_INTERVAL_MS,
  BATCH_ADD_TIMEOUT_MS,
} from "../../constants/api";
import { invalidateTrackedRepos } from "../../lib/react-query";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useI18n } from "../../i18n";
import { useToast } from "../Toast";
import styles from "./Discovery.module.css";

/**
 * 批次加入逾時後，在伺服器做完之前定期重抓追蹤清單（間隔與期限見 BATCH_ADD_FOLLOWUP_INTERVAL_MS）。
 * 計時器刻意不在元件卸載時清掉：提示叫使用者去追蹤清單看，一離開探索頁這個元件就卸載了；
 * queryClient 跟 app 同壽命，卸載後重抓照樣有效。
 */
function keepRefetchingAfterTimeout(queryClient: QueryClient): void {
  let elapsed = 0;
  const timer = setInterval(() => {
    elapsed += BATCH_ADD_FOLLOWUP_INTERVAL_MS;
    invalidateTrackedRepos(queryClient);
    if (elapsed >= BATCH_ADD_TIMEOUT_MS) clearInterval(timer);
  }, BATCH_ADD_FOLLOWUP_INTERVAL_MS);
}

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
      const result = await batchAddRepos(selectedRepos);
      if (result.success === result.total) {
        // 全部成功 — 退出 selection mode
        toast.success(
          t.discovery.batchAdd.success
            .replace("{count}", String(result.success))
            .replace("{total}", String(result.total))
        );
        invalidateTrackedRepos(queryClient);
        onDone();
      } else if (result.success > 0) {
        // 部分成功 — 保留 selection 讓使用者可重試失敗的
        toast.warning(
          t.discovery.batchAdd.success
            .replace("{count}", String(result.success))
            .replace("{total}", String(result.total))
        );
        invalidateTrackedRepos(queryClient);
      } else {
        // 全部失敗
        toast.error(t.toast.error);
      }
    } catch (err) {
      // 逾時＝伺服器還在逐筆加入（做完會立刻回應，client 斷線也不會讓它停下），說「發生錯誤」會讓人以為沒加入；
      // 其他失敗也可能已經加了前面幾筆，名單一律重抓
      const timedOut = err instanceof ApiError && err.detail === API_ERROR_MESSAGES.TIMED_OUT;
      if (timedOut) {
        toast.info(t.discovery.batchAdd.stillProcessing);
        keepRefetchingAfterTimeout(queryClient);
      } else {
        toast.error(t.toast.error);
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
