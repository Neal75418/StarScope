/**
 * GitHub 連線載入中狀態元件。
 */

import { useI18n } from "../../i18n";

export function ConnectionLoading() {
  const { t } = useI18n();

  return (
    <div className="github-status loading">
      <div className="status-icon">
        <span className="spinner" />
      </div>
      <div className="status-text">{t.githubConnection.checking}</div>
    </div>
  );
}
