/**
 * Dashboard 每週摘要元件。
 * 展示一週概覽：漲跌幅排行、信號，以及 HN 提及。
 */

import { memo, useCallback } from "react";
import { useWeeklySummary } from "../../hooks/useWeeklySummary";
import { useI18n } from "../../i18n";
import type { DashboardTimeRange } from "../../api/types";
import { formatDelta } from "../../utils/format";
import { safeOpenUrl } from "../../utils/url";
import { TREND_ARROWS } from "../../constants/trends";
import { Skeleton } from "../Skeleton";
import type { WeeklyRepoSummary, WeeklyHNMention, WeeklyRelease } from "../../api/types";

const MAX_HN_MENTIONS_DISPLAY = 6;

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${fmt(s)} – ${fmt(e)}`;
}

// 子元件

const TopMovers = memo(function TopMovers({
  gainers,
  losers,
  reposCompared,
  t,
}: {
  gainers: WeeklyRepoSummary[];
  losers: WeeklyRepoSummary[];
  reposCompared: number;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="weekly-column">
      <h4>{t.dashboard.weekly.topMovers}</h4>
      {/* 沒有 repo 比對得成時，空清單代表「還沒得比」而不是「都沒動」。
          兩者都是空的，但講錯的那個會讓人以為追蹤的東西全部沒有動靜。 */}
      {gainers.length === 0 && losers.length === 0 && (
        <div className="weekly-empty" data-testid="weekly-movers-empty">
          {reposCompared === 0 ? t.dashboard.weekly.awaitingBaseline : t.dashboard.weekly.noData}
        </div>
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
          {mentions.slice(0, MAX_HN_MENTIONS_DISPLAY).map((m) => (
            <a
              key={`${m.repo_name}-${m.hn_url}-${m.hn_title}`}
              href={m.hn_url}
              target="_blank"
              rel="noopener noreferrer"
              className="weekly-hn-item"
              onClick={(e) => {
                e.preventDefault();
                handleClick(m.hn_url);
              }}
            >
              <span className="weekly-hn-repo">{m.repo_name}</span>
              <span className="weekly-hn-title">{m.hn_title}</span>
              <span className="weekly-hn-score">{m.hn_score} pts</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
});

const ReleasesList = memo(function ReleasesList({
  releases,
  t,
}: {
  releases: WeeklyRelease[];
  t: ReturnType<typeof useI18n>["t"];
}) {
  const handleClick = useCallback((url: string) => {
    void safeOpenUrl(url);
  }, []);

  return (
    <div className="weekly-column weekly-column--wide" data-testid="weekly-releases">
      <h4>{t.dashboard.weekly.releases}</h4>
      {releases.length === 0 ? (
        <div className="weekly-empty">{t.dashboard.weekly.noReleases}</div>
      ) : (
        <div className="weekly-hn-grid">
          {releases.map((r) => (
            <a
              key={`${r.repo_name}-${r.url}`}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="weekly-hn-item"
              onClick={(e) => {
                e.preventDefault();
                handleClick(r.url);
              }}
            >
              <span className="weekly-hn-repo">{r.repo_name}</span>
              <span className="weekly-hn-title">{r.title}</span>
              {/* 標記排在右邊、與版本號同一列：一週十幾個版本裡通常只有一兩個有，
                  它們是唯一需要今天就點進去的，不該混在時間序裡看不出來 */}
              <span className="weekly-release-tags">
                {r.tags.map((tag) => (
                  <span key={tag} className={`weekly-release-tag weekly-release-tag--${tag}`}>
                    {t.dashboard.weekly.releaseTags[
                      tag as keyof typeof t.dashboard.weekly.releaseTags
                    ] ?? tag}
                  </span>
                ))}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
});

// 主元件

interface WeeklySummaryProps {
  days?: DashboardTimeRange;
}

export const WeeklySummary = memo(function WeeklySummary({ days = 7 }: WeeklySummaryProps) {
  const { t } = useI18n();
  const { data, isLoading, error } = useWeeklySummary(days);

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
        {/* 一個 repo 都比對不了時，總和不是 0，是還算不出來 */}
        <span className="weekly-total-stars" data-testid="weekly-total-stars">
          {/* 只有「確定比對過至少一個 repo」才報總和。欄位缺席時（前端比後端新，
              開發時常態）舊行為是走進有把握的那一支，把沒得比講成 0 —— 正是要消掉的東西 */}
          {(data.repos_compared ?? 0) > 0
            ? `${formatDelta(data.total_new_stars)} ${t.dashboard.weekly.starsThisWeek}`
            : t.dashboard.weekly.awaitingBaselineShort}
        </span>
      </div>

      <div className="weekly-grid">
        <TopMovers
          gainers={data.top_gainers}
          losers={data.top_losers}
          reposCompared={data.repos_compared ?? 0}
          t={t}
        />
        <ReleasesList releases={data.releases ?? []} t={t} />
        <HNMentionsList mentions={data.hn_mentions} t={t} />
      </div>
    </div>
  );
});
