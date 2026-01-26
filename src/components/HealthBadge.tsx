/**
 * Health score badge component showing project health grade.
 */

import { HealthScoreResponse } from "../api/client";
import { useHealthBadge } from "../hooks/useHealthBadge";
import { useI18n, interpolate } from "../i18n";

interface HealthBadgeProps {
  repoId: number;
  onShowDetails?: (details: HealthScoreResponse) => void;
}

const GRADE_COLORS: Record<string, { bg: string; text: string }> = {
  "A+": { bg: "#14532d", text: "#86efac" },
  A: { bg: "#166534", text: "#86efac" },
  "B+": { bg: "#15803d", text: "#bbf7d0" },
  B: { bg: "#16a34a", text: "#dcfce7" },
  "C+": { bg: "#ca8a04", text: "#fef9c3" },
  C: { bg: "#a16207", text: "#fef08a" },
  D: { bg: "#c2410c", text: "#fed7aa" },
  F: { bg: "#991b1b", text: "#fecaca" },
};

function LoadingBadge() {
  return <span className="health-badge health-badge-loading">...</span>;
}

function ErrorBadge({ error }: { error: string }) {
  return (
    <span className="health-badge health-badge-error" title={error}>
      !
    </span>
  );
}

function EmptyBadge({ calculating, onClick }: { calculating: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      className="health-badge health-badge-empty"
      onClick={onClick}
      disabled={calculating}
      title={t.healthScore.clickToCalculate}
    >
      {calculating ? "..." : "?"}
    </button>
  );
}

function GradeBadge({
  grade,
  score,
  onClick,
}: {
  grade: string;
  score: number;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const colors = GRADE_COLORS[grade] || { bg: "#6b7280", text: "#f3f4f6" };

  return (
    <button
      className="health-badge"
      style={{ backgroundColor: colors.bg, color: colors.text }}
      onClick={onClick}
      title={interpolate(t.health.titleFormat, {
        score: score.toFixed(0),
        grade,
      })}
    >
      {grade}
    </button>
  );
}

export function HealthBadge({ repoId, onShowDetails }: HealthBadgeProps) {
  const { summary, loading, calculating, error, handleCalculate, handleClick } = useHealthBadge({
    repoId,
    onShowDetails,
  });

  if (loading) {
    return <LoadingBadge />;
  }

  if (error) {
    return <ErrorBadge error={error} />;
  }

  if (!summary) {
    return <EmptyBadge calculating={calculating} onClick={handleCalculate} />;
  }

  return <GradeBadge grade={summary.grade} score={summary.overall_score} onClick={handleClick} />;
}
