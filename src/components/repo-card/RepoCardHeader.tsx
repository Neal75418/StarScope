/**
 * Repo 卡片標題列，含名稱、語言與操作按鈕。
 */

import React from "react";
import { safeOpenUrl } from "../../utils/url";
import { RepoWithSignals } from "../../api/client";
import { CommitActivityBadge } from "../CommitActivityBadge";
import { LanguagesBadge } from "../LanguagesBadge";
import { LinkExternalIcon } from "../Icons";
import { useI18n } from "../../i18n";

export interface RepoCardHeaderProps {
  repo: RepoWithSignals;
  showChart: boolean;
  showSimilar: boolean;
  isLoading?: boolean;
  selectedCategoryId?: number | null;
  activeSignalCount?: number;
  onToggleChart: () => void;
  onToggleSimilar: () => void;
  onFetch: () => void;
  onRemove: () => void;
  onRemoveFromCategory?: () => void;
}

export const RepoCardHeader = React.memo(function RepoCardHeader({
  repo,
  showChart,
  showSimilar,
  isLoading,
  selectedCategoryId,
  activeSignalCount = 0,
  onToggleChart,
  onToggleSimilar,
  onFetch,
  onRemove,
  onRemoveFromCategory,
}: RepoCardHeaderProps) {
  const { t } = useI18n();

  const handleLinkClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
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
        {repo.language && <span className="repo-language">{repo.language}</span>}
        <CommitActivityBadge repoId={repo.id} />
        <LanguagesBadge repoId={repo.id} />
        {activeSignalCount > 0 && (
          <span className="signal-badge" title={`${activeSignalCount} active signal(s)`}>
            ⚡ {activeSignalCount}
          </span>
        )}
      </div>
      <div className="repo-actions">
        <button
          onClick={onToggleChart}
          className={`btn btn-sm ${showChart ? "active" : ""}`}
          title={t.repo.chart}
          aria-label={showChart ? `${t.repo.hide} chart` : t.repo.chart}
        >
          {showChart ? t.repo.hide : t.repo.chart}
        </button>
        <button
          onClick={onToggleSimilar}
          className={`btn btn-sm ${showSimilar ? "active" : ""}`}
          title={t.repo.similar}
          aria-label={t.repo.similar}
        >
          {t.repo.similar}
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
