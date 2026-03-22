/**
 * Repo 卡片標題列，含名稱、語言與操作按鈕。
 */

import { memo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { safeOpenUrl } from "../../utils/url";
import { RepoWithSignals } from "../../api/client";
import { LinkExternalIcon } from "../Icons";
import { useI18n, interpolate } from "../../i18n";

export interface RepoCardHeaderProps {
  repo: RepoWithSignals;
  showChart: boolean;
  isLoading?: boolean;
  selectedCategoryId?: number | null;
  activeSignalCount?: number;
  onToggleChart: () => void;
  onFetch: () => void;
  onRemove: () => void;
  onRemoveFromCategory?: () => void;
}

export const RepoCardHeader = memo(function RepoCardHeader({
  repo,
  showChart,
  isLoading,
  selectedCategoryId,
  activeSignalCount = 0,
  onToggleChart,
  onFetch,
  onRemove,
  onRemoveFromCategory,
}: RepoCardHeaderProps) {
  const { t } = useI18n();

  const handleLinkClick = async (e: ReactMouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    await safeOpenUrl(repo.url);
  };

  return (
    <div className="repo-header">
      <div className="repo-info">
        <a href={repo.url} onClick={handleLinkClick} className="repo-name">
          {repo.full_name}
          <LinkExternalIcon size={14} />
        </a>
        {activeSignalCount > 0 && (
          <span
            className="signal-badge"
            title={interpolate(t.repo.activeSignals, { count: activeSignalCount })}
          >
            ⚡ {activeSignalCount}
          </span>
        )}
      </div>
      <div className="repo-actions">
        <button
          onClick={onToggleChart}
          className={`btn btn-sm ${showChart ? "active" : ""}`}
          title={showChart ? t.repo.hideChart : t.repo.showChart}
          aria-label={showChart ? t.repo.hideChart : t.repo.showChart}
        >
          {showChart ? t.repo.hide : t.repo.chart}
        </button>
        <button
          onClick={onFetch}
          disabled={isLoading}
          className="btn btn-sm"
          title={t.repo.refresh}
          aria-label={t.repo.refresh}
        >
          {t.repo.refresh}
        </button>
        {selectedCategoryId && onRemoveFromCategory && (
          <button
            onClick={onRemoveFromCategory}
            disabled={isLoading}
            className="btn btn-sm btn-warning"
            title={t.repo.removeFromCategory}
            aria-label={t.repo.removeFromCategory}
          >
            {t.repo.removeFromCategory}
          </button>
        )}
        <button
          onClick={onRemove}
          disabled={isLoading}
          className="btn btn-sm btn-danger"
          title={t.repo.remove}
          aria-label={t.repo.remove}
        >
          {t.repo.remove}
        </button>
      </div>
    </div>
  );
});
