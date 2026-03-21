/**
 * 資料新鮮度指示條，顯示最後更新時間、離線狀態、手動刷新按鈕。
 */

import { memo } from "react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useI18n } from "../i18n";
import { formatRelativeTime } from "../utils/format";

interface DataFreshnessBarProps {
  /** React Query 的 dataUpdatedAt（Unix ms），0 表示尚未載入 */
  dataUpdatedAt: number;
  /** 是否正在背景重新取得 */
  isFetching: boolean;
  /** 手動刷新 callback */
  onRefresh?: () => void;
}

/** 資料新鮮度指示條。 */
export const DataFreshnessBar = memo(function DataFreshnessBar({
  dataUpdatedAt,
  isFetching,
  onRefresh,
}: DataFreshnessBarProps) {
  const isOnline = useOnlineStatus();
  const { t } = useI18n();

  if (dataUpdatedAt === 0) return null;

  const lastUpdated = new Date(dataUpdatedAt);

  return (
    <div className="data-freshness-bar" role="status" aria-live="polite">
      <span className="freshness-time">
        {t.common.lastUpdated}: {formatRelativeTime(lastUpdated)}
      </span>

      {!isOnline && (
        <span className="freshness-offline" aria-label={t.common.offline}>
          ⚡ {t.common.offline}
        </span>
      )}

      {isFetching && <span className="freshness-syncing">{t.common.syncing}</span>}

      {onRefresh && !isFetching && (
        <button
          className="freshness-refresh btn-ghost btn-sm"
          onClick={onRefresh}
          aria-label={t.common.refresh}
        >
          ↻
        </button>
      )}
    </div>
  );
});
