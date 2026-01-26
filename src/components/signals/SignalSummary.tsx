/**
 * Signal summary cards component.
 */

import { SignalSummary as SignalSummaryType } from "../../api/client";
import { useI18n } from "../../i18n";

interface SignalSummaryProps {
  summary: SignalSummaryType;
}

export function SignalSummaryCards({ summary }: SignalSummaryProps) {
  const { t } = useI18n();

  return (
    <div className="signals-summary">
      <div className="signals-summary-card">
        <div className="signals-summary-icon">🎯</div>
        <div className="signals-summary-content">
          <div className="signals-summary-value">{summary.total_active}</div>
          <div className="signals-summary-label">{t.signals.summary.activeSignals}</div>
        </div>
      </div>
      <div className="signals-summary-card">
        <div className="signals-summary-icon">📊</div>
        <div className="signals-summary-content">
          <div className="signals-summary-value">{summary.repos_with_signals}</div>
          <div className="signals-summary-label">{t.signals.summary.reposWithSignals}</div>
        </div>
      </div>
      <div className="signals-summary-card">
        <div className="signals-summary-icon">⚠️</div>
        <div className="signals-summary-content">
          <div className="signals-summary-value">{summary.by_severity.high || 0}</div>
          <div className="signals-summary-label">{t.signals.summary.highSeverity}</div>
        </div>
      </div>
      <div className="signals-summary-card">
        <div className="signals-summary-icon">⭐</div>
        <div className="signals-summary-content">
          <div className="signals-summary-value">{summary.by_type.rising_star || 0}</div>
          <div className="signals-summary-label">{t.signals.summary.risingStars}</div>
        </div>
      </div>
    </div>
  );
}
