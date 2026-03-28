/**
 * Dashboard 的早期信號聚光燈 Widget，顯示活躍的異常偵測訊號摘要。
 */

import { memo, useMemo } from "react";
import { useI18n } from "../../i18n";
import type { EarlySignal, SignalSummary } from "../../api/client";
import { formatCompactRelativeTime } from "../../utils/format";
import { getSignalTypeConfig } from "../../constants/signalTypes";

const SEVERITY_CLASS: Record<string, string> = {
  high: "severity-high",
  medium: "severity-medium",
  low: "severity-low",
};

// Signal Spotlight — 早期訊號焦點
export const SignalSpotlight = memo(function SignalSpotlight({
  signals,
  summary,
  onAcknowledge,
}: {
  signals: EarlySignal[];
  summary: SignalSummary | null;
  onAcknowledge: (id: number) => void;
}) {
  const { t } = useI18n();

  const signalTypeLabels = useMemo<Record<string, string>>(
    () => ({
      rising_star: t.dashboard.signals.types.risingStar,
      sudden_spike: t.dashboard.signals.types.suddenSpike,
      breakout: t.dashboard.signals.types.breakout,
      viral_hn: t.dashboard.signals.types.viralHn,
    }),
    [t]
  );

  if (!summary || summary.total_active === 0) {
    return null;
  }

  return (
    <div className="dashboard-section signal-spotlight">
      <div className="signal-spotlight-header">
        <h3>{t.dashboard.signals.title}</h3>
        <span className="signal-spotlight-count">{summary.total_active}</span>
      </div>

      {/* 訊號類型摘要 */}
      <div className="signal-type-summary">
        {Object.entries(summary.by_type).map(([type, count]) => {
          const config = getSignalTypeConfig(type);
          return (
            <div key={type} className={`signal-type-chip ${config.className}`}>
              <span className="signal-type-icon">{config.icon}</span>
              <span className="signal-type-label">{signalTypeLabels[type] || type}</span>
              <span className="signal-type-count">{count}</span>
            </div>
          );
        })}
      </div>

      {/* 最新訊號列表 */}
      {signals.length > 0 && (
        <div className="signal-list">
          {signals.map((signal) => {
            const config = getSignalTypeConfig(signal.signal_type);
            const severityClass = SEVERITY_CLASS[signal.severity] || "";
            return (
              <div key={signal.id} className={`signal-item ${config.className}`}>
                <span className="signal-item-icon">{config.icon}</span>
                <div className="signal-item-content">
                  <div className="signal-item-header">
                    <span className="signal-item-repo">{signal.repo_name}</span>
                    <span className={`signal-severity-badge ${severityClass}`}>
                      {signal.severity}
                    </span>
                  </div>
                  <div className="signal-item-desc">{signal.description}</div>
                </div>
                <div className="signal-item-actions">
                  <span className="signal-item-time">
                    {formatCompactRelativeTime(signal.detected_at, t.dashboard.activity.justNow)}
                  </span>
                  <button
                    className="btn btn-sm signal-ack-btn"
                    onClick={() => onAcknowledge(signal.id)}
                    title={t.dashboard.signals.acknowledge}
                    aria-label={t.dashboard.signals.acknowledge}
                  >
                    ✓
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
