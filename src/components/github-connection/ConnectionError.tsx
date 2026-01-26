/**
 * Error state for GitHub connection.
 */

import { useI18n } from "../../i18n";

interface ConnectionErrorProps {
  onRetry: () => void;
}

export function ConnectionError({ onRetry }: ConnectionErrorProps) {
  const { t } = useI18n();

  return (
    <div className="github-status error">
      <div className="status-icon">
        <span className="icon-error">X</span>
      </div>
      <div className="status-content">
        <div className="status-text">{t.githubConnection.connectionError}</div>
      </div>
      <button onClick={onRetry} className="btn">
        {t.githubConnection.retry}
      </button>
    </div>
  );
}
