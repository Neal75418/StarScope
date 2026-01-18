/**
 * Signals page - view and manage early signals.
 */

import { useState, useEffect } from "react";
import {
  EarlySignal,
  EarlySignalType,
  EarlySignalSeverity,
  SignalSummary,
  listEarlySignals,
  getSignalSummary,
  acknowledgeSignal,
  acknowledgeAllSignals,
  triggerDetection,
  deleteSignal,
} from "../api/client";
import { formatNumber } from "../utils/format";
import { getErrorMessage } from "../utils/error";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer, useToast } from "../components/Toast";
import { useI18n, interpolate } from "../i18n";

const SIGNAL_TYPE_ICONS: Record<EarlySignalType, string> = {
  rising_star: "⭐",
  sudden_spike: "📈",
  breakout: "🚀",
  viral_hn: "🔥",
  release_surge: "📦",
};

const SEVERITY_COLORS: Record<EarlySignalSeverity, string> = {
  low: "var(--gray-400)",
  medium: "var(--warning-color)",
  high: "var(--danger-color)",
};

export function Signals() {
  const { t } = useI18n();
  const [signals, setSignals] = useState<EarlySignal[]>([]);
  const [summary, setSummary] = useState<SignalSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<EarlySignalType | "">("");
  const [filterSeverity, setFilterSeverity] = useState<EarlySignalSeverity | "">("");
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    type: "acknowledgeAll" | "delete";
    signalId?: number;
  }>({ isOpen: false, type: "acknowledgeAll" });
  const toast = useToast();

  // Signal type labels from translations
  const signalTypeLabels: Record<EarlySignalType, string> = {
    rising_star: t.signals.types.rising_star,
    sudden_spike: t.signals.types.sudden_spike,
    breakout: t.signals.types.breakout,
    viral_hn: t.signals.types.viral_hn,
    release_surge: t.signals.types.release_surge,
  };

  // Severity labels from translations
  const severityLabels: Record<EarlySignalSeverity, string> = {
    low: t.signals.severity.low,
    medium: t.signals.severity.medium,
    high: t.signals.severity.high,
  };

  // Load signals
  const loadSignals = async () => {
    try {
      const response = await listEarlySignals({
        signal_type: filterType || undefined,
        severity: filterSeverity || undefined,
        include_acknowledged: showAcknowledged,
      });
      setSignals(response.signals);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load early signals"));
    }
  };

  // Load summary
  const loadSummary = async () => {
    try {
      const data = await getSignalSummary();
      setSummary(data);
    } catch {
      // Summary loading failure is non-critical, silently ignore
    }
  };

  useEffect(() => {
    setIsLoading(true);
    Promise.all([loadSignals(), loadSummary()]).finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterSeverity, showAcknowledged]);

  const handleAcknowledge = async (signalId: number) => {
    try {
      await acknowledgeSignal(signalId);
      loadSignals();
      loadSummary();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to acknowledge signal"));
    }
  };

  const handleAcknowledgeAll = () => {
    setConfirmDialog({ isOpen: true, type: "acknowledgeAll" });
  };

  const confirmAcknowledgeAll = async () => {
    try {
      await acknowledgeAllSignals(filterType || undefined);
      toast.success(t.signals.toast.acknowledgedAll);
      loadSignals();
      loadSummary();
    } catch (err) {
      toast.error(getErrorMessage(err, t.signals.loadingError));
    } finally {
      setConfirmDialog({ isOpen: false, type: "acknowledgeAll" });
    }
  };

  const handleDelete = (signalId: number) => {
    setConfirmDialog({ isOpen: true, type: "delete", signalId });
  };

  const confirmDelete = async () => {
    if (!confirmDialog.signalId) return;

    try {
      await deleteSignal(confirmDialog.signalId);
      toast.success(t.signals.toast.deleted);
      loadSignals();
      loadSummary();
    } catch (err) {
      toast.error(getErrorMessage(err, t.signals.loadingError));
    } finally {
      setConfirmDialog({ isOpen: false, type: "delete" });
    }
  };

  const handleRunDetection = async () => {
    setIsDetecting(true);
    try {
      const result = await triggerDetection();
      toast.success(
        interpolate(t.signals.detection.complete, {
          repos: result.repos_scanned,
          signals: result.signals_detected,
        })
      );
      loadSignals();
      loadSummary();
    } catch (err) {
      toast.error(getErrorMessage(err, t.signals.loadingError));
    } finally {
      setIsDetecting(false);
    }
  };

  const formatRelativeTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <div className="page">
        <div className="loading">{t.signals.loading}</div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t.signals.title}</h1>
        <p className="subtitle">{t.signals.subtitle}</p>
      </header>

      {/* Summary Cards */}
      {summary && (
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
      )}

      {/* Toolbar */}
      <div className="signals-toolbar">
        <div className="signals-filters">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as EarlySignalType | "")}
            className="signals-select"
          >
            <option value="">{t.signals.toolbar.allTypes}</option>
            <option value="rising_star">{signalTypeLabels.rising_star}</option>
            <option value="sudden_spike">{signalTypeLabels.sudden_spike}</option>
            <option value="breakout">{signalTypeLabels.breakout}</option>
            <option value="viral_hn">{signalTypeLabels.viral_hn}</option>
            <option value="release_surge">{signalTypeLabels.release_surge}</option>
          </select>

          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value as EarlySignalSeverity | "")}
            className="signals-select"
          >
            <option value="">{t.signals.toolbar.allSeverities}</option>
            <option value="high">{severityLabels.high}</option>
            <option value="medium">{severityLabels.medium}</option>
            <option value="low">{severityLabels.low}</option>
          </select>

          <label className="signals-checkbox">
            <input
              type="checkbox"
              checked={showAcknowledged}
              onChange={(e) => setShowAcknowledged(e.target.checked)}
            />
            {t.signals.toolbar.showAcknowledged}
          </label>
        </div>

        <div className="signals-actions">
          <button
            className="btn btn-secondary"
            onClick={handleAcknowledgeAll}
            disabled={signals.filter((s) => !s.acknowledged).length === 0}
          >
            {t.signals.actions.acknowledgeAll}
          </button>
          <button className="btn btn-primary" onClick={handleRunDetection} disabled={isDetecting}>
            {isDetecting ? t.signals.toolbar.detecting : t.signals.toolbar.runDetection}
          </button>
        </div>
      </div>

      {/* Signals List */}
      <div className="signals-list">
        {signals.length === 0 ? (
          <div className="signals-empty">
            <p>{t.signals.emptyState.noSignals}</p>
            <p className="hint">
              {showAcknowledged
                ? t.signals.emptyState.noMatch
                : t.signals.emptyState.allAcknowledged}
            </p>
          </div>
        ) : (
          signals.map((signal) => (
            <div
              key={signal.id}
              className={`signal-card ${signal.acknowledged ? "acknowledged" : ""}`}
            >
              <div className="signal-icon">{SIGNAL_TYPE_ICONS[signal.signal_type]}</div>

              <div className="signal-content">
                <div className="signal-header">
                  <span className="signal-type">{signalTypeLabels[signal.signal_type]}</span>
                  <span
                    className="signal-severity"
                    style={{ color: SEVERITY_COLORS[signal.severity] }}
                  >
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

              <div className="signal-time">{formatRelativeTime(signal.detected_at)}</div>

              <div className="signal-actions">
                {!signal.acknowledged && (
                  <button
                    className="btn btn-sm"
                    onClick={() => handleAcknowledge(signal.id)}
                    title={t.signals.actions.acknowledge}
                  >
                    ✓
                  </button>
                )}
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => handleDelete(signal.id)}
                  title={t.signals.actions.delete}
                >
                  &times;
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)}>x</button>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDialog.isOpen && confirmDialog.type === "acknowledgeAll"}
        title={t.signals.confirm.acknowledgeAllTitle}
        message={t.signals.confirm.acknowledgeAllMessage}
        confirmText={t.signals.actions.acknowledgeAll}
        variant="warning"
        onConfirm={confirmAcknowledgeAll}
        onCancel={() => setConfirmDialog({ isOpen: false, type: "acknowledgeAll" })}
      />

      <ConfirmDialog
        isOpen={confirmDialog.isOpen && confirmDialog.type === "delete"}
        title={t.signals.confirm.deleteTitle}
        message={t.signals.confirm.deleteMessage}
        confirmText={t.common.delete}
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDialog({ isOpen: false, type: "delete" })}
      />

      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
    </div>
  );
}
