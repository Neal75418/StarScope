/**
 * Velocity comparison component showing growth rates for multiple repos.
 */

import { useState, useEffect, useCallback } from "react";
import { VelocityComparisonData, getVelocityComparison } from "../../api/client";
import { formatNumber, formatDelta } from "../../utils/format";
import { useI18n } from "../../i18n";

interface VelocityComparisonProps {
  groupId: number;
}

export function VelocityComparison({ groupId }: VelocityComparisonProps) {
  const { t } = useI18n();
  const [data, setData] = useState<VelocityComparisonData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getVelocityComparison(groupId);
      setData(result);
    } catch (err) {
      console.error("Failed to load velocity comparison:", err);
      setError(t.compare.loadingError);
    } finally {
      setIsLoading(false);
    }
  }, [groupId, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (isLoading) {
    return <div className="velocity-comparison loading">{t.common.loading}</div>;
  }

  if (error) {
    return <div className="velocity-comparison error">{error}</div>;
  }

  if (!data || data.data.length === 0) {
    return null;
  }

  // Sort by velocity (highest first)
  const sortedItems = [...data.data].sort((a, b) => b.velocity - a.velocity);
  const maxVelocity = sortedItems[0]?.velocity || 1;

  return (
    <div className="velocity-comparison">
      <h3>{t.compare.velocity?.title ?? "Velocity Comparison"}</h3>
      <div className="velocity-bars">
        {sortedItems.map((item, index) => (
          <div key={item.repo_id} className="velocity-bar-item">
            <div className="velocity-bar-label">
              <span className="rank">#{index + 1}</span>
              <span className="repo-name">{item.full_name}</span>
            </div>
            <div className="velocity-bar-container">
              <div
                className="velocity-bar-fill"
                style={{ width: `${(item.velocity / maxVelocity) * 100}%` }}
              />
              <span className="velocity-value">
                {formatNumber(item.velocity)} {t.compare.velocity?.starsPerDay ?? "stars/day"}
              </span>
            </div>
            <div className="velocity-deltas">
              <span className={`delta ${item.delta_7d >= 0 ? "positive" : "negative"}`}>
                7d: {formatDelta(item.delta_7d)}
              </span>
              <span className={`delta ${item.delta_30d >= 0 ? "positive" : "negative"}`}>
                30d: {formatDelta(item.delta_30d)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
