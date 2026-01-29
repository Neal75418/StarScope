/**
 * Trends page - shows repos sorted by various metrics
 */

import { TrendArrow } from "../components/TrendArrow";
import { AnimatedPage } from "../components/motion";
import { formatNumber, formatDelta } from "../utils/format";
import { useI18n } from "../i18n";
import { useTrends, SortOption, TrendingRepo } from "../hooks/useTrends";

const SORT_KEYS: SortOption[] = ["velocity", "stars_delta_7d", "stars_delta_30d", "acceleration"];

import React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

function TrendRow({ repo }: { repo: TrendingRepo }) {
  const handleLinkClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    await openUrl(repo.url);
  };

  return (
    <tr>
      <td className="rank-col">
        <span className="rank-badge">{repo.rank}</span>
      </td>
      <td className="repo-col">
        <a href={repo.url} onClick={handleLinkClick} className="repo-link">
          {repo.full_name}
        </a>
        {repo.language && <span className="repo-language">{repo.language}</span>}
      </td>
      <td className="stars-col">{formatNumber(repo.stars)}</td>
      <td className="delta-col positive">{formatDelta(repo.stars_delta_7d)}</td>
      <td className="delta-col positive">{formatDelta(repo.stars_delta_30d)}</td>
      <td className="velocity-col">{repo.velocity !== null ? repo.velocity.toFixed(1) : "—"}</td>
      <td className="trend-col">
        <TrendArrow trend={repo.trend} />
      </td>
    </tr>
  );
}

export function Trends() {
  const { t } = useI18n();
  const { trends, loading, error, sortBy, setSortBy, retry } = useTrends();

  if (loading) {
    return <div className="loading">{t.trends.loading}</div>;
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>{t.trends.loadingError}</h2>
        <p>{error}</p>
        <button className="btn btn-primary" onClick={retry}>
          {t.trends.retry}
        </button>
      </div>
    );
  }

  const sortLabels: Record<SortOption, string> = {
    velocity: t.trends.sortOptions.velocity,
    stars_delta_7d: t.trends.sortOptions.stars_delta_7d,
    stars_delta_30d: t.trends.sortOptions.stars_delta_30d,
    acceleration: t.trends.sortOptions.acceleration,
  };

  return (
    <AnimatedPage className="page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.trends.title}</h1>
        <p className="subtitle">{t.trends.subtitle}</p>
      </header>

      <div className="toolbar">
        <div className="sort-tabs" data-testid="sort-tabs">
          {SORT_KEYS.map((key) => (
            <button
              key={key}
              data-testid={`sort-${key}`}
              className={`sort-tab ${sortBy === key ? "active" : ""}`}
              onClick={() => setSortBy(key)}
            >
              {sortLabels[key]}
            </button>
          ))}
        </div>
      </div>

      {trends.length === 0 ? (
        <div className="empty-state" data-testid="empty-state">
          <p>{t.trends.empty}</p>
        </div>
      ) : (
        <div className="trends-table" data-testid="trends-table">
          <table>
            <thead>
              <tr>
                <th className="rank-col">{t.trends.columns.rank}</th>
                <th className="repo-col">{t.trends.columns.repo}</th>
                <th className="stars-col">{t.trends.columns.stars}</th>
                <th className="delta-col">{t.trends.columns.delta7d}</th>
                <th className="delta-col">{t.trends.columns.delta30d}</th>
                <th className="velocity-col">{t.trends.columns.velocity}</th>
                <th className="trend-col">{t.repo.trend}</th>
              </tr>
            </thead>
            <tbody>
              {trends.map((repo) => (
                <TrendRow key={repo.id} repo={repo} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AnimatedPage>
  );
}
