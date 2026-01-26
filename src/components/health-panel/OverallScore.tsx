/**
 * Overall health score display component.
 */

import { HealthScoreResponse } from "../../api/client";
import { useI18n, interpolate } from "../../i18n";
import { getScoreColor, formatDate } from "./healthScoreUtils";

interface OverallScoreProps {
  details: HealthScoreResponse;
}

export function OverallScore({ details }: OverallScoreProps) {
  const { t } = useI18n();

  return (
    <div className="overall-score-section">
      <div
        className="overall-grade"
        style={{ backgroundColor: getScoreColor(details.overall_score) }}
      >
        {details.grade}
      </div>
      <div className="overall-details">
        <div className="overall-number">
          {details.overall_score.toFixed(1)}
          <span className="out-of">/100</span>
        </div>
        <div className="calculated-at">
          {interpolate(t.healthScore.lastCalculated, {
            date: formatDate(details.calculated_at),
          })}
        </div>
      </div>
    </div>
  );
}
