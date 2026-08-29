/**
 * 趨勢表格列，從 Trends.tsx 提取，支援展開/收合。
 */

import { memo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { TrendArrow } from "../../components/TrendArrow";
import { formatNumber, formatDelta, formatVelocity, deltaClass } from "../../utils/format";
import { safeOpenUrl } from "../../utils/url";
import type { TrendingRepo } from "../../api/client";
import type { EarlySignal } from "../../api/types";
import { BreakoutBadge } from "./BreakoutBadge";

interface TrendRowProps {
  repo: TrendingRepo;
  isExpanded: boolean;
  onToggleExpand: (repoId: number) => void;
  signals?: EarlySignal[];
}

export const TrendRow = memo(function TrendRow({
  repo,
  isExpanded,
  onToggleExpand,
  signals,
}: TrendRowProps) {
  const handleLinkClick = async (e: ReactMouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();
    await safeOpenUrl(repo.url);
  };

  const handleRowClick = () => {
    onToggleExpand(repo.id);
  };

  return (
    <tr
      className={`trend-row-expandable ${isExpanded ? "expanded" : ""}`}
      onClick={handleRowClick}
      data-testid={`trend-row-${repo.id}`}
      aria-expanded={isExpanded}
    >
      <td className="rank-col">
        <span className="trend-expand-icon" aria-hidden="true">
          {isExpanded ? "▾" : "▸"}
        </span>
        <span className="rank-badge">{repo.rank}</span>
      </td>
      <td className="repo-col">
        <a href={repo.url} onClick={handleLinkClick} className="repo-link">
          {repo.full_name}
        </a>
        {repo.language && <span className="repo-language">{repo.language}</span>}
        {signals && signals.length > 0 && <BreakoutBadge signals={signals} />}
      </td>
      <td className="stars-col">{formatNumber(repo.stars)}</td>
      <td className={`delta-col ${deltaClass(repo.stars_delta_7d)}`}>
        {formatDelta(repo.stars_delta_7d)}
      </td>
      <td className={`delta-col ${deltaClass(repo.stars_delta_30d)}`}>
        {formatDelta(repo.stars_delta_30d)}
      </td>
      <td className="velocity-col">{formatVelocity(repo.velocity)}</td>
      <td className="trend-col">
        <TrendArrow trend={repo.trend} />
      </td>
      <td className={`delta-col ${deltaClass(repo.forks_delta_7d)}`}>
        {formatDelta(repo.forks_delta_7d)}
      </td>
      <td className={`delta-col ${deltaClass(repo.issues_delta_7d, true)}`}>
        {formatDelta(repo.issues_delta_7d)}
      </td>
    </tr>
  );
});
