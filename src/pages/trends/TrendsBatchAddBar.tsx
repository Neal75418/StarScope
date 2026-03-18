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
    if (selectedRepos.length === 0) return;
    setIsAdding(true);
    try {
      const result = await batchAddRepos(
        selectedRepos.map((r) => ({ owner: r.owner, name: r.name }))
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
      onDone();
      if (result.failed > 0) {
        onError(
          result.success === 0
            ? t.trends.batch.error
            : t.trends.batch.partial
                .replace("{success}", String(result.success))
                .replace("{total}", String(result.total))
        );
      }
    } catch {
      onError(t.trends.batch.error);
    } finally {
      setIsAdding(false);
    }
  }, [selectedRepos, queryClient, onDone, onError, t]);

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
