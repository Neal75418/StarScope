/**
 * Health panel action buttons component.
 */

import { useI18n } from "../../i18n";

interface HealthPanelActionsProps {
  recalculating: boolean;
  onRecalculate: () => void;
  onClose: () => void;
}

export function HealthPanelActions({
  recalculating,
  onRecalculate,
  onClose,
}: HealthPanelActionsProps) {
  const { t } = useI18n();

  return (
    <div className="health-panel-actions">
      <button className="btn btn-primary" onClick={onRecalculate} disabled={recalculating}>
        {recalculating ? t.healthScore.calculating : t.healthScore.recalculate}
      </button>
      <button className="btn" onClick={onClose}>
        {t.healthScore.close}
      </button>
    </div>
  );
}
