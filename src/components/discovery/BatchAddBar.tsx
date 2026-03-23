/**
 * 批次加入 watchlist 的操作列，固定在結果區域底部。
 */

import { useState, useCallback, memo } from "react";
import { batchAddRepos } from "../../api/client";
import { queryKeys } from "../../lib/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../../i18n";
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
        void queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
        onDone();
      } else if (result.success > 0) {
        // 部分成功 — 保留 selection 讓使用者可重試失敗的
        toast.warning(
          t.discovery.batchAdd.success
            .replace("{count}", String(result.success))
            .replace("{total}", String(result.total))
        );
        void queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
      } else {
        // 全部失敗
        toast.error(t.toast.error);
      }
    } catch {
      toast.error(t.toast.error);
    } finally {
      setIsAdding(false);
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
