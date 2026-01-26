/**
 * Repo card stats display component.
 */

import { ReactNode } from "react";
import { RepoWithSignals } from "../../api/client";
import { TrendArrow } from "../TrendArrow";
import { formatNumber, formatDelta, formatVelocity } from "../../utils/format";
import { useI18n } from "../../i18n";

interface RepoCardStatsProps {
  repo: RepoWithSignals;
}

interface StatItemProps {
  label: string;
  value: string | ReactNode;
  className?: string;
}

function StatItem({ label, value, className }: StatItemProps) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${className || ""}`}>{value}</span>
    </div>
  );
}

export function RepoCardStats({ repo }: RepoCardStatsProps) {
  const { t } = useI18n();

  return (
    <div className="repo-stats">
      <StatItem label={t.repo.stars} value={formatNumber(repo.stars)} />
      <StatItem label="7d" value={formatDelta(repo.stars_delta_7d)} className="delta" />
      <StatItem label="30d" value={formatDelta(repo.stars_delta_30d)} className="delta" />
      <StatItem label={t.repo.velocity} value={formatVelocity(repo.velocity)} />
      <StatItem label={t.repo.trend} value={<TrendArrow trend={repo.trend} />} />
    </div>
  );
}
