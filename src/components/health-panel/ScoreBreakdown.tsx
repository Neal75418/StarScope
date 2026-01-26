/**
 * Score breakdown section component.
 */

import { HealthScoreResponse } from "../../api/client";
import { useI18n, interpolate } from "../../i18n";
import { ScoreRow } from "./ScoreRow";
import { formatResponseTime } from "./healthScoreUtils";

interface ScoreBreakdownProps {
  details: HealthScoreResponse;
}

export function ScoreBreakdown({ details }: ScoreBreakdownProps) {
  const { t } = useI18n();
  const metrics = details.metrics;

  const getDocumentationDetail = (): string | undefined => {
    if (!metrics) return undefined;
    const docs = [
      metrics.has_readme && "README",
      metrics.has_license && "LICENSE",
      metrics.has_contributing && "CONTRIBUTING",
    ].filter(Boolean);
    return docs.length > 0 ? docs.join(", ") : t.healthScore.format.none;
  };

  return (
    <div className="score-breakdown">
      <h4>{t.healthScore.scoreBreakdown}</h4>

      <ScoreRow
        label={t.healthScore.metrics.issueResponse}
        score={details.issue_response_score}
        weight="20%"
        detail={
          metrics?.avg_issue_response_hours
            ? interpolate(t.healthScore.avgPrefix, {
                time: formatResponseTime(metrics.avg_issue_response_hours, t.healthScore.time),
              })
            : undefined
        }
      />

      <ScoreRow
        label={t.healthScore.metrics.prMergeRate}
        score={details.pr_merge_score}
        weight="20%"
        detail={
          metrics?.pr_merge_rate
            ? interpolate(t.healthScore.format.merged, {
                rate: metrics.pr_merge_rate.toFixed(0),
              })
            : undefined
        }
      />

      <ScoreRow
        label={t.healthScore.metrics.releaseCadence}
        score={details.release_cadence_score}
        weight="15%"
        detail={
          metrics?.days_since_last_release != null
            ? interpolate(t.healthScore.time.daysAgo, { days: metrics.days_since_last_release })
            : undefined
        }
      />

      <ScoreRow
        label={t.healthScore.metrics.busFactor}
        score={details.bus_factor_score}
        weight="15%"
        detail={
          metrics?.contributor_count
            ? interpolate(t.healthScore.format.contributors, {
                count: metrics.contributor_count,
              })
            : undefined
        }
      />

      <ScoreRow
        label={t.healthScore.metrics.documentation}
        score={details.documentation_score}
        weight="10%"
        detail={getDocumentationDetail()}
      />

      <ScoreRow
        label={t.healthScore.metrics.dependencies}
        score={details.dependency_score}
        weight="10%"
      />

      <ScoreRow
        label={t.healthScore.metrics.starVelocity}
        score={details.velocity_score}
        weight="10%"
      />
    </div>
  );
}
