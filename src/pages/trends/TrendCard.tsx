/**
 * 趨勢 Grid 卡片，顯示 repo 指標與 rank badge。
 */

import { memo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { TrendArrow } from "../../components/TrendArrow";
import { formatNumber, formatDelta, formatVelocity, deltaClass } from "../../utils/format";
import { safeOpenUrl } from "../../utils/url";
import type { useI18n } from "../../i18n";
import { useNavigation } from "../../contexts/NavigationContext";
import type { TrendingRepo } from "../../api/client";
import type { EarlySignal } from "../../api/types";
import { BreakoutBadge } from "./BreakoutBadge";

interface TrendCardProps {
  repo: TrendingRepo;
  t: ReturnType<typeof useI18n>["t"];
  signals?: EarlySignal[];
}

function getRankClass(rank: number): string {
  if (rank === 1) return "trend-card-rank-gold";
  if (rank === 2) return "trend-card-rank-silver";
  if (rank === 3) return "trend-card-rank-bronze";
  return "";
}

export const TrendCard = memo(function TrendCard({ repo, t, signals }: TrendCardProps) {
  const { navigateTo } = useNavigation();

  const handleLinkClick = async (e: ReactMouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    await safeOpenUrl(repo.url);
  };

  return (
    <div className="trend-card" data-testid={`trend-card-${repo.id}`}>
      <div className={`trend-card-rank ${getRankClass(repo.rank)}`}>#{repo.rank}</div>

      <div className="trend-card-header">
        <a href={repo.url} onClick={handleLinkClick} className="repo-link trend-card-name">
          {repo.full_name}
        </a>
        {repo.language && <span className="repo-language">{repo.language}</span>}
        {signals && signals.length > 0 && <BreakoutBadge signals={signals} />}
      </div>

      {repo.description && <p className="trend-card-description">{repo.description}</p>}

      <div className="trend-card-metrics">
        <div className="trend-card-metric">
          <span className="trend-card-metric-label">{t.trends.columns.stars}</span>
          <span className="trend-card-metric-value">{formatNumber(repo.stars)}</span>
        </div>
        <div className="trend-card-metric">
          <span className="trend-card-metric-label">{t.trends.columns.velocity}</span>
          <span className="trend-card-metric-value">{formatVelocity(repo.velocity)}</span>
        </div>
        <div className="trend-card-metric">
          <span className="trend-card-metric-label">{t.trends.columns.delta7d}</span>
          {/* 寫死 positive 會讓掉星的 repo 顯示綠字——與 TrendRow／TrendExpandedRow 同一條規則 */}
          <span className={`trend-card-metric-value ${deltaClass(repo.stars_delta_7d)}`}>
            {formatDelta(repo.stars_delta_7d)}
          </span>
        </div>
        <div className="trend-card-metric">
          <span className="trend-card-metric-label">{t.repo.trend}</span>
          <TrendArrow trend={repo.trend} />
        </div>
      </div>

      <div className="trend-card-footer">
        <button
          className="btn btn-sm btn-outline"
          onClick={(e) => {
            e.stopPropagation();
            navigateTo("compare", { preselectedIds: [repo.id] });
          }}
          data-testid={`trend-compare-btn-${repo.id}`}
        >
          {t.trends.compareWith}
        </button>
      </div>
    </div>
  );
});
