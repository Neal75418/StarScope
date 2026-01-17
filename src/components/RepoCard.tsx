/**
 * Repository card component displaying repo info and signals.
 */

import { RepoWithSignals } from "../api/client";
import { TrendArrow } from "./TrendArrow";

interface RepoCardProps {
  repo: RepoWithSignals;
  onFetch: (id: number) => void;
  onRemove: (id: number) => void;
  isLoading?: boolean;
}

function formatNumber(num: number | null): string {
  if (num === null) return "—";
  if (Math.abs(num) >= 1000) {
    return (num / 1000).toFixed(1) + "k";
  }
  return num.toFixed(0);
}

function formatDelta(num: number | null): string {
  if (num === null) return "—";
  const sign = num >= 0 ? "+" : "";
  if (Math.abs(num) >= 1000) {
    return sign + (num / 1000).toFixed(1) + "k";
  }
  return sign + num.toFixed(0);
}

function formatVelocity(num: number | null): string {
  if (num === null) return "—";
  return num.toFixed(1) + "/day";
}

export function RepoCard({ repo, onFetch, onRemove, isLoading }: RepoCardProps) {
  return (
    <div className="repo-card">
      <div className="repo-header">
        <div className="repo-info">
          <a
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="repo-name"
          >
            {repo.full_name}
          </a>
          {repo.language && (
            <span className="repo-language">{repo.language}</span>
          )}
        </div>
        <div className="repo-actions">
          <button
            onClick={() => onFetch(repo.id)}
            disabled={isLoading}
            className="btn btn-sm"
            title="Refresh data"
          >
            🔄
          </button>
          <button
            onClick={() => onRemove(repo.id)}
            disabled={isLoading}
            className="btn btn-sm btn-danger"
            title="Remove from watchlist"
          >
            ✕
          </button>
        </div>
      </div>

      {repo.description && (
        <p className="repo-description">{repo.description}</p>
      )}

      <div className="repo-stats">
        <div className="stat">
          <span className="stat-label">Stars</span>
          <span className="stat-value">{formatNumber(repo.stars)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">7d</span>
          <span className="stat-value delta">{formatDelta(repo.stars_delta_7d)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">30d</span>
          <span className="stat-value delta">{formatDelta(repo.stars_delta_30d)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Velocity</span>
          <span className="stat-value">{formatVelocity(repo.velocity)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Trend</span>
          <span className="stat-value">
            <TrendArrow trend={repo.trend} />
          </span>
        </div>
      </div>
    </div>
  );
}
