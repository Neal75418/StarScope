/**
 * 趨勢頁批次加入 watchlist 的操作列。
 */

import { useState, useCallback, memo } from "react";
import { batchAddRepos } from "../../api/client";
import { queryKeys } from "../../lib/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../../i18n";
import type { TrendingRepo } from "../../api/client";

interface TrendsBatchAddBarProps {
  selectedRepos: TrendingRepo[];
  selectedCount: number;
  onDone: () => void;
  onError: (msg: string) => void;
}

export const TrendsBatchAddBar = memo(function TrendsBatchAddBar({
  selectedRepos,
  selectedCount,
  onDone,
  onError,
}: TrendsBatchAddBarProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);

  const handleBatchAdd = useCallback(async () => {
    if (isAdding || selectedRepos.length === 0) return;
    setIsAdding(true);
    try {
      const result = await batchAddRepos(
        selectedRepos.map((r) => ({ owner: r.owner, name: r.name }))
      );
      if (result.success === result.total) {
        // 全部成功 — 退出 selection mode
        void queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
        onDone();
      } else if (result.success > 0) {
        // 部分成功 — 保留 selection 讓使用者可重試
        void queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
        onError(
          t.trends.batch.partial
            .replace("{success}", String(result.success))
            .replace("{total}", String(result.total))
        );
      } else {
        // 全部失敗
        onError(t.trends.batch.error);
      }
    } catch {
      onError(t.trends.batch.error);
    } finally {
      setIsAdding(false);
    }
  }, [isAdding, selectedRepos, queryClient, onDone, onError, t]);

  if (selectedCount === 0) return null;

  return (
    <div className="trends-batch-bar" data-testid="trends-batch-bar">
      <span className="trends-batch-count">
        {t.trends.batch.selected.replace("{count}", String(selectedCount))}
      </span>
      <button
        className="btn btn-primary btn-sm"
        onClick={handleBatchAdd}
        disabled={isAdding}
        data-testid="trends-batch-add-btn"
      >
        {isAdding
          ? t.trends.batch.adding
          : t.trends.batch.addToWatchlist.replace("{count}", String(selectedCount))}
      </button>
      <button className="btn btn-sm" onClick={onDone}>
        {t.trends.batch.cancel}
      </button>
    </div>
  );
});
