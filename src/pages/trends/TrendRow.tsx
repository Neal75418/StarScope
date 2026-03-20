/**
 * 趨勢表格列，從 Trends.tsx 提取，支援展開/收合。
 */

import { memo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { TrendArrow } from "../../components/TrendArrow";
import { formatNumber, formatDelta, formatVelocity } from "../../utils/format";
import { safeOpenUrl } from "../../utils/url";
import type { useI18n } from "../../i18n";
import type { TrendingRepo } from "../../api/client";
import type { EarlySignal } from "../../api/types";
import { BreakoutBadge } from "./BreakoutBadge";

interface TrendRowProps {
  repo: TrendingRepo;
  isInWatchlist: boolean;
  isAdding: boolean;
  onAddToWatchlist: (repo: TrendingRepo) => void;
  isExpanded: boolean;
  onToggleExpand: (repoId: number) => void;
  t: ReturnType<typeof useI18n>["t"];
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (repoId: number) => void;
  signals?: EarlySignal[];
}

export const TrendRow = memo(function TrendRow({
  repo,
  isInWatchlist,
  isAdding,
  onAddToWatchlist,
  isExpanded,
  onToggleExpand,
  t,
  isSelectionMode,
  isSelected,
  onToggleSelection,
  signals,
}: TrendRowProps) {
  const handleLinkClick = async (e: ReactMouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();
    await safeOpenUrl(repo.url);
  };

  const handleRowClick = () => {
    if (isSelectionMode && onToggleSelection) {
      onToggleSelection(repo.id);
    } else {
      onToggleExpand(repo.id);
    }
  };

  const handleActionClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
  };

  return (
    <tr
      className={`trend-row-expandable ${isExpanded ? "expanded" : ""}`}
      onClick={handleRowClick}
      data-testid={`trend-row-${repo.id}`}
      aria-expanded={!isSelectionMode ? isExpanded : undefined}
    >
      <td className="rank-col">
        {isSelectionMode ? (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelection?.(repo.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${repo.full_name}`}
          />
        ) : (
          <>
            <span className="trend-expand-icon" aria-hidden="true">
              {isExpanded ? "▾" : "▸"}
            </span>
            <span className="rank-badge">{repo.rank}</span>
          </>
        )}
      </td>
      <td className="repo-col">
        <a href={repo.url} onClick={handleLinkClick} className="repo-link">
          {repo.full_name}
        </a>
        {repo.language && <span className="repo-language">{repo.language}</span>}
        {signals && signals.length > 0 && <BreakoutBadge signals={signals} />}
      </td>
      <td className="stars-col">{formatNumber(repo.stars)}</td>
      <td
        className={`delta-col ${(repo.stars_delta_7d ?? 0) > 0 ? "positive" : (repo.stars_delta_7d ?? 0) < 0 ? "negative" : ""}`}
      >
        {formatDelta(repo.stars_delta_7d)}
      </td>
      <td
        className={`delta-col ${(repo.stars_delta_30d ?? 0) > 0 ? "positive" : (repo.stars_delta_30d ?? 0) < 0 ? "negative" : ""}`}
      >
        {formatDelta(repo.stars_delta_30d)}
      </td>
      <td className="velocity-col">{formatVelocity(repo.velocity)}</td>
      <td className="trend-col">
        <TrendArrow trend={repo.trend} />
      </td>
      <td
        className={`delta-col ${(repo.forks_delta_7d ?? 0) > 0 ? "positive" : (repo.forks_delta_7d ?? 0) < 0 ? "negative" : ""}`}
      >
        {formatDelta(repo.forks_delta_7d)}
      </td>
      <td
        className={`delta-col ${(repo.issues_delta_7d ?? 0) > 0 ? "negative" : (repo.issues_delta_7d ?? 0) < 0 ? "positive" : ""}`}
      >
        {formatDelta(repo.issues_delta_7d)}
      </td>
      <td className="action-col" onClick={handleActionClick}>
        {isInWatchlist ? (
          <span className="trends-in-watchlist">{t.trends.filters.inWatchlist}</span>
        ) : (
          <button
            className="btn btn-sm btn-outline trends-add-btn"
            onClick={() => onAddToWatchlist(repo)}
            disabled={isAdding}
          >
            {t.trends.filters.addToWatchlist}
          </button>
        )}
      </td>
    </tr>
  );
});
