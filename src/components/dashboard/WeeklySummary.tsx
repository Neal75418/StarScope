/**
 * Weekly Summary component for the Dashboard.
 * Shows a week-at-a-glance: top movers, signals, and HN mentions.
 */

import { memo, useCallback } from "react";
import { useWeeklySummary } from "../../hooks/useWeeklySummary";
import { useI18n } from "../../i18n";
import { formatDelta } from "../../utils/format";
import { safeOpenUrl } from "../../utils/url";
import { TREND_ARROWS } from "../../constants/trends";
import { Skeleton } from "../Skeleton";
import type { WeeklyRepoSummary, WeeklyHNMention } from "../../api/types";

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${fmt(s)} – ${fmt(e)}`;
}

// --- Sub-components ---

const TopMovers = memo(function TopMovers({
  gainers,
  losers,
  t,
}: {
  gainers: WeeklyRepoSummary[];
  losers: WeeklyRepoSummary[];
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="weekly-column">
      <h4>{t.dashboard.weekly.topMovers}</h4>
      {gainers.length === 0 && losers.length === 0 && (
        <div className="weekly-empty">{t.dashboard.weekly.noData}</div>
      )}
      {gainers.map((r) => (
        <div key={r.repo_id} className="weekly-mover weekly-mover--up">
          <span className="weekly-mover-name">{r.full_name}</span>
          <span className="weekly-mover-delta trend-up">{formatDelta(r.stars_delta_7d)}</span>
          <span className="weekly-mover-trend">{TREND_ARROWS[r.trend] ?? "→"}</span>
        </div>
      ))}
      {losers.map((r) => (
        <div key={r.repo_id} className="weekly-mover weekly-mover--down">
          <span className="weekly-mover-name">{r.full_name}</span>
          <span className="weekly-mover-delta trend-down">{formatDelta(r.stars_delta_7d)}</span>
          <span className="weekly-mover-trend">{TREND_ARROWS[r.trend] ?? "→"}</span>
        </div>
      ))}
    </div>
  );
});

const SignalsOverview = memo(function SignalsOverview({
  alertsTriggered,
  earlySignalsDetected,
  earlySignalsByType,
  accelerating,
  decelerating,
  t,
}: {
  alertsTriggered: number;
  earlySignalsDetected: number;
  earlySignalsByType: Record<string, number>;
  accelerating: number;
  decelerating: number;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="weekly-column">
      <h4>{t.dashboard.weekly.signals}</h4>
      <div className="weekly-stat-row">
        <span className="weekly-stat-label">{t.dashboard.weekly.alertsTriggered}</span>
        <span className="weekly-stat-value">{alertsTriggered}</span>
      </div>
      <div className="weekly-stat-row">
        <span className="weekly-stat-label">{t.dashboard.weekly.earlySignals}</span>
        <span className="weekly-stat-value">{earlySignalsDetected}</span>
      </div>
      {Object.entries(earlySignalsByType).map(([type, count]) => (
        <div key={type} className="weekly-stat-row weekly-stat-row--sub">
          <span className="weekly-stat-label">{type.replace(/_/g, " ")}</span>
          <span className="weekly-stat-value">{count}</span>
        </div>
      ))}
      <div className="weekly-momentum">
        <span className="trend-up">
          {accelerating} {t.dashboard.weekly.accelerating}
        </span>
        <span className="trend-down">
          {decelerating} {t.dashboard.weekly.decelerating}
        </span>
      </div>
    </div>
  );
});

const HNMentionsList = memo(function HNMentionsList({
  mentions,
  t,
}: {
  mentions: WeeklyHNMention[];
  t: ReturnType<typeof useI18n>["t"];
}) {
  const handleClick = useCallback((url: string) => {
    void safeOpenUrl(url);
  }, []);

  return (
    <div className="weekly-column weekly-column--wide">
      <h4>{t.dashboard.weekly.hnMentions}</h4>
      {mentions.length === 0 ? (
        <div className="weekly-empty">{t.dashboard.weekly.noHnMentions}</div>
      ) : (
        <div className="weekly-hn-grid">
          {mentions.slice(0, 6).map((m, i) => (
            <div
              key={i}
              role="link"
              tabIndex={0}
              className="weekly-hn-item"
              onClick={() => handleClick(m.hn_url)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleClick(m.hn_url);
              }}
            >
              <span className="weekly-hn-repo">{m.repo_name}</span>
              <span className="weekly-hn-title">{m.hn_title}</span>
              <span className="weekly-hn-score">{m.hn_score} pts</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// --- Main component ---

export const WeeklySummary = memo(function WeeklySummary() {
  const { t } = useI18n();
  const { data, isLoading, error } = useWeeklySummary();

  if (isLoading) {
    return (
      <div className="dashboard-section weekly-summary">
        <Skeleton width={200} height={24} style={{ marginBottom: 16 }} />
        <div className="weekly-grid">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="weekly-column">
              <Skeleton width={120} height={18} style={{ marginBottom: 12 }} />
              <Skeleton width="100%" height={14} style={{ marginBottom: 8 }} />
              <Skeleton width="80%" height={14} style={{ marginBottom: 8 }} />
              <Skeleton width="60%" height={14} />
            </div>
          ))}
          <div className="weekly-column weekly-column--wide">
            <Skeleton width={120} height={18} style={{ marginBottom: 12 }} />
            <Skeleton width="100%" height={14} style={{ marginBottom: 8 }} />
            <Skeleton width="80%" height={14} />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-section weekly-summary">
        <div className="weekly-header">
          <h3>{t.dashboard.weekly.title}</h3>
        </div>
        <div className="weekly-empty">{t.dashboard.weekly.loadError}</div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="dashboard-section weekly-summary">
      <div className="weekly-header">
        <h3>
          {t.dashboard.weekly.title} ({formatDateRange(data.period_start, data.period_end)})
        </h3>
        <span className="weekly-total-stars">
          {formatDelta(data.total_new_stars)} {t.dashboard.weekly.starsThisWeek}
        </span>
      </div>

      <div className="weekly-grid">
        <TopMovers gainers={data.top_gainers} losers={data.top_losers} t={t} />
        <SignalsOverview
          alertsTriggered={data.alerts_triggered}
          earlySignalsDetected={data.early_signals_detected}
          earlySignalsByType={data.early_signals_by_type}
          accelerating={data.accelerating}
          decelerating={data.decelerating}
          t={t}
        />
        <HNMentionsList mentions={data.hn_mentions} t={t} />
      </div>
    </div>
  );
});
