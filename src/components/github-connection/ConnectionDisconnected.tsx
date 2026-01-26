/**
 * Disconnected state for GitHub connection.
 */

import { useI18n } from "../../i18n";

interface ConnectionDisconnectedProps {
  onConnect: () => void;
}

export function ConnectionDisconnected({ onConnect }: ConnectionDisconnectedProps) {
  const { t } = useI18n();

  return (
    <div className="github-status disconnected">
      <div className="status-icon">
        <span className="icon-disconnected">!</span>
      </div>
      <div className="status-content">
        <div className="status-text">{t.githubConnection.notConnected}</div>
        <div className="status-hint">{t.githubConnection.connectHint}</div>
      </div>
      <button onClick={onConnect} className="btn btn-primary">
        {t.githubConnection.connect}
      </button>
    </div>
  );
}
