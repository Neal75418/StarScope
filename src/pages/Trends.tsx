/**
 * Trends page - shows repos sorted by various metrics
 */

import { useState, useEffect } from "react";
import { TrendArrow } from "../components/TrendArrow";
import { API_ENDPOINT } from "../config";
import { formatNumber, formatDelta } from "../utils/format";

type SortOption = "velocity" | "stars_delta_7d" | "stars_delta_30d" | "acceleration";

interface TrendingRepo {
  id: number;
  owner: string;
  name: string;
  full_name: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number | null;
  stars_delta_7d: number | null;
  stars_delta_30d: number | null;
  velocity: number | null;
  acceleration: number | null;
  trend: number | null;
  rank: number;
}

interface TrendsResponse {
  repos: TrendingRepo[];
  total: number;
  sort_by: string;
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "velocity", label: "Stars/Day" },
  { value: "stars_delta_7d", label: "7d Delta" },
  { value: "stars_delta_30d", label: "30d Delta" },
  { value: "acceleration", label: "Acceleration" },
];

export function Trends() {
  const [trends, setTrends] = useState<TrendingRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("velocity");

  const fetchTrends = async (sort: SortOption) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_ENDPOINT}/trends/?sort_by=${sort}&limit=50`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: TrendsResponse = await res.json();
      setTrends(data.repos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch trends");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrends(sortBy);
  }, [sortBy]);

  if (loading) {
    return <div className="loading">Loading trends...</div>;
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>Error loading trends</h2>
        <p>{error}</p>
        <button className="btn btn-primary" onClick={() => fetchTrends(sortBy)}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Trends</h1>
        <p className="subtitle">Top performing repos in your watchlist</p>
      </header>

      <div className="toolbar">
        <div className="sort-tabs">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={`sort-tab ${sortBy === option.value ? "active" : ""}`}
              onClick={() => setSortBy(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {trends.length === 0 ? (
        <div className="empty-state">
          <p>No trends data available.</p>
          <p>Add repos to your watchlist and wait for data to accumulate.</p>
        </div>
      ) : (
        <div className="trends-table">
          <table>
            <thead>
              <tr>
                <th className="rank-col">#</th>
                <th className="repo-col">Repository</th>
                <th className="stars-col">Stars</th>
                <th className="delta-col">7d</th>
                <th className="delta-col">30d</th>
                <th className="velocity-col">Stars/Day</th>
                <th className="trend-col">Trend</th>
              </tr>
            </thead>
            <tbody>
              {trends.map((repo) => (
                <tr key={repo.id}>
                  <td className="rank-col">
                    <span className="rank-badge">{repo.rank}</span>
                  </td>
                  <td className="repo-col">
                    <a
                      href={repo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="repo-link"
                    >
                      {repo.full_name}
                    </a>
                    {repo.language && (
                      <span className="repo-language">{repo.language}</span>
                    )}
                  </td>
                  <td className="stars-col">{formatNumber(repo.stars)}</td>
                  <td className="delta-col positive">
                    {formatDelta(repo.stars_delta_7d)}
                  </td>
                  <td className="delta-col positive">
                    {formatDelta(repo.stars_delta_30d)}
                  </td>
                  <td className="velocity-col">
                    {repo.velocity !== null ? repo.velocity.toFixed(1) : "—"}
                  </td>
                  <td className="trend-col">
                    <TrendArrow trend={repo.trend} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
