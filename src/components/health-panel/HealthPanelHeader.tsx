/**
 * Health panel header component.
 */

import { useI18n } from "../../i18n";

interface HealthPanelHeaderProps {
  repoName: string;
  onClose: () => void;
}

export function HealthPanelHeader({ repoName, onClose }: HealthPanelHeaderProps) {
  const { t } = useI18n();

  return (
    <div className="health-panel-header">
      <div className="header-info">
        <h3>{t.healthScore.title}</h3>
        <span className="repo-name">{repoName}</span>
      </div>
      <button className="close-btn" onClick={onClose}>
        &times;
      </button>
    </div>
  );
}
