/**
 * GitHub 連線中狀態元件。
 */

import { useI18n } from "../../i18n";

export function ConnectionConnecting() {
  const { t } = useI18n();

  return (
    <div className="github-status connecting">
      <div className="status-icon">
        <span className="spinner" />
      </div>
      <div className="status-text">{t.githubConnection.initiating}</div>
    </div>
  );
}
