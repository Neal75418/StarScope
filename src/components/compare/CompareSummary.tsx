/**
 * Comparison summary cards component.
 */

import { ComparisonGroupDetail } from "../../api/client";
import { formatNumber } from "../../utils/format";
import { useI18n } from "../../i18n";

interface CompareSummaryProps {
  summary: ComparisonGroupDetail["summary"];
}

export function CompareSummary({ summary }: CompareSummaryProps) {
  const { t } = useI18n();

  return (
    <div className="compare-summary">
      <div className="compare-summary-card">
        <div className="compare-summary-label">{t.compare.summary.leaderByStars}</div>
        <div className="compare-summary-value">{summary.leader_by_stars || "-"}</div>
      </div>
      <div className="compare-summary-card">
        <div className="compare-summary-label">{t.compare.summary.leaderByVelocity}</div>
        <div className="compare-summary-value">{summary.leader_by_velocity || "-"}</div>
      </div>
      <div className="compare-summary-card">
        <div className="compare-summary-label">{t.compare.summary.leaderByHealth}</div>
        <div className="compare-summary-value">{summary.leader_by_health || "-"}</div>
      </div>
      <div className="compare-summary-card">
        <div className="compare-summary-label">{t.compare.summary.totalStars}</div>
        <div className="compare-summary-value">{formatNumber(summary.total_stars)}</div>
      </div>
    </div>
  );
}
