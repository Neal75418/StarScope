/**
 * 相似 repo 面板標題列元件。
 */

import { useI18n } from "../../i18n";

interface SimilarReposHeaderProps {
  onClose?: () => void;
  onRecalculate?: () => void;
  isRecalculating?: boolean;
}

export function SimilarReposHeader({
  onClose,
  onRecalculate,
  isRecalculating,
}: SimilarReposHeaderProps) {
  const { t } = useI18n();

  return (
    <div className="similar-repos-header">
      <h4>{t.similarRepos.title}</h4>
      <div className="similar-repos-actions">
        {onRecalculate && (
          <button
            className="btn btn-sm"
            onClick={onRecalculate}
            disabled={isRecalculating}
            title={t.similarRepos.recalculate ?? "Recalculate"}
          >
            {isRecalculating ? "↻" : "⟳"}
          </button>
        )}
        {onClose && (
          <button className="btn btn-sm" onClick={onClose}>
            &times;
          </button>
        )}
      </div>
    </div>
  );
}
