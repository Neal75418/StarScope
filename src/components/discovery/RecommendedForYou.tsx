/**
 * 個人化推薦區塊，顯示在 Discovery 頁面頂部。
 */

import { memo, useState, useCallback } from "react";
import { useI18n } from "../../i18n";
import { usePersonalizedRecs } from "../../hooks/usePersonalizedRecs";
import { Skeleton } from "../Skeleton";
import { formatNumber, formatDelta } from "../../utils/format";
import { safeOpenUrl } from "../../utils/url";
import type { PersonalizedRecommendation } from "../../api/types";

const TREND_ICON: Record<number, string> = {
  1: "↑",
  0: "→",
  [-1]: "↓",
};

function buildReason(rec: PersonalizedRecommendation, t: ReturnType<typeof useI18n>["t"]): string {
  const r = t.discovery.recommendations;
  const parts: string[] = [r.similarTo.replace("{repo}", rec.source_repo_name)];
  if (rec.shared_topics.length > 0) {
    parts.push(r.topics.replace("{topics}", rec.shared_topics.join(", ")));
  }
  if (rec.same_language) {
    parts.push(r.sameLanguage);
  }
  return parts.join(" · ");
}

const RecCard = memo(function RecCard({
  rec,
  t,
}: {
  rec: PersonalizedRecommendation;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const handleClick = useCallback(() => {
    void safeOpenUrl(rec.url);
  }, [rec.url]);

  return (
    <div
      role="link"
      tabIndex={0}
      className="rec-card"
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleClick();
      }}
    >
      <div className="rec-card-header">
        <span className="rec-card-name">{rec.full_name}</span>
        {rec.language && <span className="rec-card-lang">{rec.language}</span>}
      </div>
      {rec.description && <div className="rec-card-desc">{rec.description}</div>}
      <div className="rec-card-metrics">
        {rec.stars != null && <span className="rec-metric">★ {formatNumber(rec.stars)}</span>}
        {rec.velocity != null && (
          <span className="rec-metric">
            {t.discovery.recommendations.velocity}: {formatDelta(rec.velocity)}
          </span>
        )}
        {rec.trend != null && <span className="rec-metric">{TREND_ICON[rec.trend] ?? "→"}</span>}
        <span className="rec-metric rec-similarity">
          {t.discovery.recommendations.matchScore} {Math.round(rec.similarity_score * 100)}%
        </span>
      </div>
      <div className="rec-card-reason">{buildReason(rec, t)}</div>
    </div>
  );
});

export const RecommendedForYou = memo(function RecommendedForYou() {
  const { t } = useI18n();
  const { data, isLoading, error } = usePersonalizedRecs(6);
  const [collapsed, setCollapsed] = useState(false);

  // Don't render anything if there's an error or no recommendations
  if (error) return null;

  if (isLoading) {
    return (
      <div className="rec-section">
        <div className="rec-section-header">
          <Skeleton width={200} height={24} />
        </div>
        <div className="rec-grid">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rec-card">
              <Skeleton width="70%" height={16} style={{ marginBottom: 8 }} />
              <Skeleton width="100%" height={12} style={{ marginBottom: 12 }} />
              <Skeleton width="60%" height={14} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data || data.total === 0) return null;

  return (
    <div className="rec-section">
      <div className="rec-section-header">
        <div>
          <h3>{t.discovery.recommendations.title}</h3>
          <p className="rec-subtitle">{t.discovery.recommendations.subtitle}</p>
        </div>
        <button className="btn btn-sm rec-toggle" onClick={() => setCollapsed((prev) => !prev)}>
          {collapsed ? "▼" : "▲"}
        </button>
      </div>
      {!collapsed && (
        <div className="rec-grid">
          {data.recommendations.map((rec) => (
            <RecCard key={rec.repo_id} rec={rec} t={t} />
          ))}
        </div>
      )}
    </div>
  );
});
