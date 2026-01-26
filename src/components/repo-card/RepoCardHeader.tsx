/**
 * Repo card header with name, language, health badge and actions.
 */

import { useState } from "react";
import { RepoWithSignals, HealthScoreResponse, getExportHistoryUrl } from "../../api/client";
import { HealthBadge } from "../HealthBadge";
import { CommitActivityBadge } from "../CommitActivityBadge";
import { LanguagesBadge } from "../LanguagesBadge";
import { useI18n } from "../../i18n";

interface RepoCardHeaderProps {
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
  onAddToComparison?: () => void;
  onShowHealthDetails: (details: HealthScoreResponse | null) => void;
}

export function RepoCardHeader({
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
  onAddToComparison,
  onShowHealthDetails,
}: RepoCardHeaderProps) {
  const { t } = useI18n();
  const [showExportMenu, setShowExportMenu] = useState(false);

  return (
    <div className="repo-header">
      <div className="repo-info">
        <a href={repo.url} target="_blank" rel="noopener noreferrer" className="repo-name">
          {repo.full_name}
        </a>
        {repo.language && <span className="repo-language">{repo.language}</span>}
        <HealthBadge repoId={repo.id} onShowDetails={onShowHealthDetails} />
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
        >
          {showChart ? t.repo.hide : t.repo.chart}
        </button>
        <button
          onClick={onToggleSimilar}
          className={`btn btn-sm ${showSimilar ? "active" : ""}`}
          title={t.repo.similar}
        >
          {t.repo.similar}
        </button>
        {onAddToComparison && (
          <button
            onClick={onAddToComparison}
            disabled={isLoading}
            className="btn btn-sm"
            title={t.repo.addToComparison}
          >
            {t.repo.addToComparison}
          </button>
        )}
        <div className="export-dropdown">
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            className={`btn btn-sm ${showExportMenu ? "active" : ""}`}
            title={t.repo.exportHistory ?? "Export History"}
          >
            {t.repo.exportHistory ?? "Export"}
          </button>
          {showExportMenu && (
            <div className="export-dropdown-menu">
              <a
                href={getExportHistoryUrl(repo.id, "json")}
                className="export-option"
                download
                onClick={() => setShowExportMenu(false)}
              >
                JSON
              </a>
              <a
                href={getExportHistoryUrl(repo.id, "csv")}
                className="export-option"
                download
                onClick={() => setShowExportMenu(false)}
              >
                CSV
              </a>
            </div>
          )}
        </div>
        <button
          onClick={onFetch}
          disabled={isLoading}
          className="btn btn-sm"
          title={t.repo.refresh}
        >
          {t.repo.refresh}
        </button>
        {selectedCategoryId && onRemoveFromCategory && (
          <button
            onClick={onRemoveFromCategory}
            disabled={isLoading}
            className="btn btn-sm btn-warning"
            title={t.repo.removeFromCategory}
          >
            {t.repo.removeFromCategory}
          </button>
        )}
        <button
          onClick={onRemove}
          disabled={isLoading}
          className="btn btn-sm btn-danger"
          title={t.repo.remove}
        >
          {t.repo.remove}
        </button>
      </div>
    </div>
  );
}
