/**
 * Diff Summary Panel — 自動比較 repos 的核心指標差異。
 * 顯示 leader（最多星數）、fastest（最高 velocity）、most gained（最高 7d delta）。
 */

import { useMemo, memo } from "react";
import type { ComparisonRepoData } from "../../api/types";
import { useI18n } from "../../i18n";
import { formatNumber, formatDelta } from "../../utils/format";

interface DiffSummaryPanelProps {
  repos: ComparisonRepoData[];
}

interface Insight {
  label: string;
  repoName: string;
  value: string;
  color: string;
}

export const DiffSummaryPanel = memo(function DiffSummaryPanel({ repos }: DiffSummaryPanelProps) {
  const { t } = useI18n();

  const insights = useMemo<Insight[]>(() => {
    if (repos.length < 2) return [];

    const result: Insight[] = [];

    // 領先者 — 當前星數最高
    const leader = repos.reduce((best, r) => (r.current_stars > best.current_stars ? r : best));
    result.push({
      label: t.compare.diff.leader,
      repoName: leader.repo_name,
      value: formatNumber(leader.current_stars),
      color: leader.color,
    });

    // 成長最快 — 速度最高
    const withVelocity = repos.filter((r) => r.velocity != null);
    if (withVelocity.length > 0) {
      const fastest = withVelocity.reduce((best, r) =>
        (r.velocity ?? 0) > (best.velocity ?? 0) ? r : best
      );
      result.push({
        label: t.compare.diff.fastest,
        repoName: fastest.repo_name,
        value: `${fastest.velocity?.toFixed(1) ?? "—"}${t.compare.perDay}`,
        color: fastest.color,
      });
    }

    // 增長最多 — 7 天星數增量最高
    const withDelta = repos.filter((r) => r.stars_delta_7d != null);
    if (withDelta.length > 0) {
      const mostGained = withDelta.reduce((best, r) =>
        (r.stars_delta_7d ?? 0) > (best.stars_delta_7d ?? 0) ? r : best
      );
      result.push({
        label: t.compare.diff.mostGained,
        repoName: mostGained.repo_name,
        value: formatDelta(mostGained.stars_delta_7d ?? 0),
        color: mostGained.color,
      });
    }

    // 差距 — 第一名與第二名的星數差
    const sortedByStars = [...repos].sort((a, b) => b.current_stars - a.current_stars);
    if (sortedByStars.length >= 2) {
      const gap = sortedByStars[0].current_stars - sortedByStars[1].current_stars;
      result.push({
        label: t.compare.diff.gap,
        repoName: `${sortedByStars[0].repo_name.split("/")[1]} ${t.compare.diff.versus} ${sortedByStars[1].repo_name.split("/")[1]}`,
        value: formatNumber(gap),
        color: sortedByStars[0].color,
      });

      // 追趕/拉開 — 領先者與追趕者的速度差
      const leaderVel = sortedByStars[0].velocity ?? 0;
      const runnerVel = sortedByStars[1].velocity ?? 0;
      const isClosing = runnerVel > leaderVel;
      const rate = Math.abs(runnerVel - leaderVel).toFixed(1);
      result.push({
        label: isClosing ? t.compare.diff.closing : t.compare.diff.widening,
        repoName: sortedByStars[1].repo_name,
        value: `${rate}${t.compare.perDay}`,
        color: sortedByStars[1].color,
      });
    }

    return result;
  }, [repos, t]);

  if (insights.length === 0) return null;

  return (
    <div className="diff-summary-panel" data-testid="diff-summary-panel">
      <h3>{t.compare.diff.title}</h3>
      <div className="diff-summary-cards">
        {insights.map((insight) => (
          <div key={insight.label} className="diff-summary-card" data-testid="diff-summary-card">
            <div className="diff-summary-label">{insight.label}</div>
            <div className="diff-summary-repo">
              <span className="compare-color-dot" style={{ background: insight.color }} />
              {insight.repoName}
            </div>
            <div className="diff-summary-value">{insight.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
});
