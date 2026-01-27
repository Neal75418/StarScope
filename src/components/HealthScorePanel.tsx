/**
 * Health score details panel showing comprehensive health metrics.
 */

import { createPortal } from "react-dom";
import { HealthScoreResponse } from "../api/client";
import { useHealthScorePanel } from "../hooks/useHealthScorePanel";
import {
  HealthPanelHeader,
  OverallScore,
  ScoreBreakdown,
  HealthPanelActions,
} from "./health-panel";

interface HealthScorePanelProps {
  details: HealthScoreResponse;
  onClose: () => void;
  onRecalculate?: (newDetails: HealthScoreResponse) => void;
}

export function HealthScorePanel({ details, onClose, onRecalculate }: HealthScorePanelProps) {
  const { recalculating, error, handleRecalculate } = useHealthScorePanel({
    repoId: details.repo_id,
    onClose,
    onRecalculate,
  });

  return createPortal(
    <div className="health-panel-overlay" onClick={onClose}>
      <div className="health-panel" onClick={(e) => e.stopPropagation()}>
        <HealthPanelHeader repoName={details.repo_name} onClose={onClose} />
        <OverallScore details={details} />
        <ScoreBreakdown details={details} />

        {error && <div className="health-panel-error">{error}</div>}

        <HealthPanelActions
          recalculating={recalculating}
          onRecalculate={handleRecalculate}
          onClose={onClose}
        />
      </div>
    </div>,
    document.body
  );
}
