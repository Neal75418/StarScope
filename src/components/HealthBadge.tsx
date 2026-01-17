/**
 * Health score badge component showing project health grade.
 */

import { useState, useEffect, useRef } from "react";
import {
  getHealthScoreSummary,
  getHealthScore,
  calculateHealthScore,
  HealthScoreSummary,
  HealthScoreResponse,
} from "../api/client";

interface HealthBadgeProps {
  repoId: number;
  onShowDetails?: (details: HealthScoreResponse) => void;
}

// Grade color mapping
const GRADE_COLORS: Record<string, { bg: string; text: string }> = {
  "A+": { bg: "#14532d", text: "#86efac" },
  "A": { bg: "#166534", text: "#86efac" },
  "B+": { bg: "#15803d", text: "#bbf7d0" },
  "B": { bg: "#16a34a", text: "#dcfce7" },
  "C+": { bg: "#ca8a04", text: "#fef9c3" },
  "C": { bg: "#a16207", text: "#fef08a" },
  "D": { bg: "#c2410c", text: "#fed7aa" },
  "F": { bg: "#991b1b", text: "#fecaca" },
};

export function HealthBadge({ repoId, onShowDetails }: HealthBadgeProps) {
  const [summary, setSummary] = useState<HealthScoreSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    setLoading(true);
    setError(null);

    getHealthScoreSummary(repoId)
      .then((data) => {
        if (isMountedRef.current) {
          setSummary(data);
        }
      })
      .catch((err) => {
        if (isMountedRef.current) {
          // 404 means no score calculated yet - not an error
          if (err.status === 404) {
            setSummary(null);
          } else {
            setError("Failed to load");
            console.error("Health score error:", err);
          }
        }
      })
      .finally(() => {
        if (isMountedRef.current) {
          setLoading(false);
        }
      });

    return () => {
      isMountedRef.current = false;
    };
  }, [repoId]);

  const handleCalculate = async () => {
    setCalculating(true);
    setError(null);

    try {
      const result = await calculateHealthScore(repoId);
      if (!isMountedRef.current) return;

      setSummary({
        repo_id: result.repo_id,
        overall_score: result.overall_score,
        grade: result.grade,
        calculated_at: result.calculated_at,
      });
      if (onShowDetails) {
        onShowDetails(result);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setError("Calculation failed");
      console.error("Health score calculation error:", err);
    } finally {
      if (isMountedRef.current) {
        setCalculating(false);
      }
    }
  };

  const handleClick = async () => {
    if (!summary) {
      // No score yet, calculate it
      await handleCalculate();
    } else if (onShowDetails) {
      // Score exists, fetch cached details (no recalculation)
      try {
        const fullDetails = await getHealthScore(repoId);
        if (isMountedRef.current) {
          onShowDetails(fullDetails);
        }
      } catch (err) {
        console.error("Failed to get health details:", err);
      }
    }
  };

  if (loading) {
    return <span className="health-badge health-badge-loading">...</span>;
  }

  if (error) {
    return (
      <span className="health-badge health-badge-error" title={error}>
        !
      </span>
    );
  }

  if (!summary) {
    return (
      <button
        className="health-badge health-badge-empty"
        onClick={handleCalculate}
        disabled={calculating}
        title="Click to calculate health score"
      >
        {calculating ? "..." : "?"}
      </button>
    );
  }

  const colors = GRADE_COLORS[summary.grade] || { bg: "#6b7280", text: "#f3f4f6" };

  return (
    <button
      className="health-badge"
      style={{ backgroundColor: colors.bg, color: colors.text }}
      onClick={handleClick}
      title={`Health Score: ${summary.overall_score.toFixed(0)} (${summary.grade})`}
    >
      {summary.grade}
    </button>
  );
}
