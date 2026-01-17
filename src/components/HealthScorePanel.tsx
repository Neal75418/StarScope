/**
 * Health score details panel showing comprehensive health metrics.
 */

import { useState, useEffect, useRef } from "react";
import { HealthScoreResponse, calculateHealthScore } from "../api/client";

interface HealthScorePanelProps {
  details: HealthScoreResponse;
  onClose: () => void;
  onRecalculate?: (newDetails: HealthScoreResponse) => void;
}

// Score thresholds for color coding
function getScoreColor(score: number | null): string {
  if (score === null) return "var(--gray-400)";
  if (score >= 80) return "var(--success-color)";
  if (score >= 60) return "var(--warning-color)";
  return "var(--danger-color)";
}

// Format hours to readable string
function formatResponseTime(hours: number | null): string {
  if (hours === null) return "N/A";
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = hours / 24;
  if (days < 7) return `${days.toFixed(1)} days`;
  const weeks = days / 7;
  return `${weeks.toFixed(1)} weeks`;
}

// Format date
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ScoreRowProps {
  label: string;
  score: number | null;
  detail?: string;
  weight: string;
}

function ScoreRow({ label, score, detail, weight }: ScoreRowProps) {
  return (
    <div className="score-row">
      <div className="score-label">
        <span className="label-text">{label}</span>
        <span className="weight-text">{weight}</span>
      </div>
      <div className="score-bar-container">
        <div
          className="score-bar"
          style={{
            width: `${score ?? 0}%`,
            backgroundColor: getScoreColor(score),
          }}
        />
      </div>
      <div className="score-value" style={{ color: getScoreColor(score) }}>
        {score !== null ? score.toFixed(0) : "—"}
      </div>
      {detail && <div className="score-detail">{detail}</div>}
    </div>
  );
}

export function HealthScorePanel({
  details,
  onClose,
  onRecalculate,
}: HealthScorePanelProps) {
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleRecalculate = async () => {
    setRecalculating(true);
    setError(null);
    try {
      const newDetails = await calculateHealthScore(details.repo_id);
      if (!isMountedRef.current) return;
      if (onRecalculate) {
        onRecalculate(newDetails);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setError("Failed to recalculate. Please try again.");
      console.error("Failed to recalculate health score:", err);
    } finally {
      if (isMountedRef.current) {
        setRecalculating(false);
      }
    }
  };

  const metrics = details.metrics;

  return (
    <div className="health-panel-overlay" onClick={onClose}>
      <div className="health-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="health-panel-header">
          <div className="header-info">
            <h3>Project Health Score</h3>
            <span className="repo-name">{details.repo_name}</span>
          </div>
          <button className="close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Overall Score */}
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
              Last calculated: {formatDate(details.calculated_at)}
            </div>
          </div>
        </div>

        {/* Score Breakdown */}
        <div className="score-breakdown">
          <h4>Score Breakdown</h4>

          <ScoreRow
            label="Issue Response"
            score={details.issue_response_score}
            weight="20%"
            detail={
              metrics?.avg_issue_response_hours
                ? `Avg: ${formatResponseTime(metrics.avg_issue_response_hours)}`
                : undefined
            }
          />

          <ScoreRow
            label="PR Merge Rate"
            score={details.pr_merge_score}
            weight="20%"
            detail={
              metrics?.pr_merge_rate
                ? `${metrics.pr_merge_rate.toFixed(0)}% merged`
                : undefined
            }
          />

          <ScoreRow
            label="Release Cadence"
            score={details.release_cadence_score}
            weight="15%"
            detail={
              metrics?.days_since_last_release != null
                ? `${metrics.days_since_last_release} days ago`
                : undefined
            }
          />

          <ScoreRow
            label="Bus Factor"
            score={details.bus_factor_score}
            weight="15%"
            detail={
              metrics?.contributor_count
                ? `${metrics.contributor_count} contributors`
                : undefined
            }
          />

          <ScoreRow
            label="Documentation"
            score={details.documentation_score}
            weight="10%"
            detail={
              metrics
                ? [
                    metrics.has_readme && "README",
                    metrics.has_license && "LICENSE",
                    metrics.has_contributing && "CONTRIBUTING",
                  ]
                    .filter(Boolean)
                    .join(", ") || "None"
                : undefined
            }
          />

          <ScoreRow
            label="Dependencies"
            score={details.dependency_score}
            weight="10%"
          />

          <ScoreRow
            label="Star Velocity"
            score={details.velocity_score}
            weight="10%"
          />
        </div>

        {/* Error Display */}
        {error && (
          <div className="health-panel-error">{error}</div>
        )}

        {/* Actions */}
        <div className="health-panel-actions">
          <button
            className="btn btn-primary"
            onClick={handleRecalculate}
            disabled={recalculating}
          >
            {recalculating ? "Calculating..." : "Recalculate"}
          </button>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
