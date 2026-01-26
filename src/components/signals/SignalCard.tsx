/**
 * Individual signal card component.
 */

import { EarlySignal } from "../../api/client";
import { formatNumber } from "../../utils/format";
import { interpolate } from "../../i18n";
import { SIGNAL_TYPE_ICONS, SEVERITY_COLORS, useSignalLabels } from "./signalLabels";

function formatRelativeTime(dateStr: string, t: ReturnType<typeof useSignalLabels>["t"]): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return t.relativeTime.justNow;
  if (diffHours < 24) return interpolate(t.relativeTime.hoursAgo, { hours: diffHours });
  if (diffDays < 7) return interpolate(t.relativeTime.daysAgo, { days: diffDays });
  return date.toLocaleDateString();
}

interface SignalCardProps {
  signal: EarlySignal;
  onAcknowledge: (id: number) => void;
  onDelete: (id: number) => void;
}

export function SignalCard({ signal, onAcknowledge, onDelete }: SignalCardProps) {
  const { signalTypeLabels, severityLabels, t } = useSignalLabels();

  return (
    <div className={`signal-card ${signal.acknowledged ? "acknowledged" : ""}`}>
      <div className="signal-icon">{SIGNAL_TYPE_ICONS[signal.signal_type]}</div>

      <div className="signal-content">
        <div className="signal-header">
          <span className="signal-type">{signalTypeLabels[signal.signal_type]}</span>
          <span className="signal-severity" style={{ color: SEVERITY_COLORS[signal.severity] }}>
            {severityLabels[signal.severity].toUpperCase()}
          </span>
        </div>

        <div className="signal-repo">{signal.repo_name}</div>
        <div className="signal-description">{signal.description}</div>

        <div className="signal-meta">
          {signal.star_count !== null && (
            <span className="signal-meta-item">
              {t.signals.card.stars}: {formatNumber(signal.star_count)}
            </span>
          )}
          {signal.velocity_value !== null && (
            <span className="signal-meta-item">
              {t.signals.card.velocity}: {signal.velocity_value.toFixed(1)}/day
            </span>
          )}
          {signal.percentile_rank !== null && (
            <span className="signal-meta-item">
              {t.signals.card.top} {(100 - signal.percentile_rank).toFixed(0)}%
            </span>
          )}
        </div>
      </div>

      <div className="signal-time">{formatRelativeTime(signal.detected_at, t)}</div>

      <div className="signal-actions">
        {!signal.acknowledged && (
          <button
            className="btn btn-sm"
            onClick={() => onAcknowledge(signal.id)}
            title={t.signals.actions.acknowledge}
          >
            ✓
          </button>
        )}
        <button
          className="btn btn-sm btn-danger"
          onClick={() => onDelete(signal.id)}
          title={t.signals.actions.delete}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
