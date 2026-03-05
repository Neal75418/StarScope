/**
 * Compare page — multi-repo star trend comparison.
 */

import { useState, useMemo, useCallback, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useI18n } from "../i18n";
import { useComparison } from "../hooks/useComparison";
import { getRepos } from "../api/client";
import type { RepoWithSignals, ComparisonRepoData, ComparisonTimeRange } from "../api/types";
import { AnimatedPage, FadeIn } from "../components/motion";
import { Skeleton } from "../components/Skeleton";
import { formatNumber, formatDelta } from "../utils/format";
import { TREND_ARROWS } from "../constants/trends";
import { queryKeys } from "../lib/react-query";

const TIME_RANGES: ComparisonTimeRange[] = ["7d", "30d", "90d", "all"];
const STORAGE_KEY = "starscope-compare-repos";

function loadSavedRepoIds(): number[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

// --- RepoSelector ---
const RepoSelector = memo(function RepoSelector({
  repos,
  selectedIds,
  onToggle,
  t,
}: {
  repos: RepoWithSignals[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return repos;
    const q = search.toLowerCase();
    return repos.filter((r) => r.full_name.toLowerCase().includes(q));
  }, [repos, search]);

  return (
    <div className="compare-selector">
      <h3>{t.compare.selectRepos}</h3>
      <input
        type="text"
        className="compare-search"
        placeholder={t.compare.searchPlaceholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="compare-repo-list">
        {filtered.map((repo) => {
          const isSelected = selectedIds.includes(repo.id);
          const disabled = !isSelected && selectedIds.length >= 5;
          return (
            <button
              key={repo.id}
              className={`compare-repo-chip ${isSelected ? "selected" : ""}`}
              onClick={() => onToggle(repo.id)}
              disabled={disabled}
              title={disabled ? t.compare.maxRepos : repo.full_name}
            >
              {repo.full_name}
              {isSelected && <span className="compare-chip-x">×</span>}
            </button>
          );
        })}
      </div>
      {selectedIds.length < 2 && <p className="compare-hint">{t.compare.minRepos}</p>}
    </div>
  );
});

// --- MetricsTable ---
const MetricsTable = memo(function MetricsTable({
  repos,
  t,
}: {
  repos: ComparisonRepoData[];
  t: ReturnType<typeof useI18n>["t"];
}) {
  const sorted = useMemo(
    () => [...repos].sort((a, b) => (b.velocity ?? 0) - (a.velocity ?? 0)),
    [repos]
  );

  return (
    <div className="compare-metrics">
      <h3>{t.compare.metrics}</h3>
      <div className="compare-table-wrapper">
        <table className="compare-table">
          <thead>
            <tr>
              <th>{t.compare.columns.repo}</th>
              <th>{t.compare.columns.stars}</th>
              <th>{t.compare.columns.delta7d}</th>
              <th>{t.compare.columns.delta30d}</th>
              <th>{t.compare.columns.velocity}</th>
              <th>{t.compare.columns.acceleration}</th>
              <th>{t.compare.columns.trend}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.repo_id}>
                <td>
                  <span className="compare-color-dot" style={{ background: r.color }} />
                  {r.repo_name}
                </td>
                <td>{formatNumber(r.current_stars)}</td>
                <td
                  className={
                    r.stars_delta_7d && r.stars_delta_7d > 0
                      ? "trend-up"
                      : r.stars_delta_7d && r.stars_delta_7d < 0
                        ? "trend-down"
                        : ""
                  }
                >
                  {r.stars_delta_7d != null ? formatDelta(r.stars_delta_7d) : "—"}
                </td>
                <td
                  className={
                    r.stars_delta_30d && r.stars_delta_30d > 0
                      ? "trend-up"
                      : r.stars_delta_30d && r.stars_delta_30d < 0
                        ? "trend-down"
                        : ""
                  }
                >
                  {r.stars_delta_30d != null ? formatDelta(r.stars_delta_30d) : "—"}
                </td>
                <td>{r.velocity != null ? r.velocity.toFixed(1) : "—"}</td>
                <td>{r.acceleration != null ? r.acceleration.toFixed(1) : "—"}</td>
                <td>{r.trend != null ? (TREND_ARROWS[r.trend] ?? "→") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

// --- Main ---
export function Compare() {
  const { t } = useI18n();
  const [selectedIds, setSelectedIds] = useState<number[]>(loadSavedRepoIds);
  const [timeRange, setTimeRange] = useState<ComparisonTimeRange>("30d");
  const [normalize, setNormalize] = useState(false);

  const reposQuery = useQuery<RepoWithSignals[], Error>({
    queryKey: queryKeys.repos.lists(),
    queryFn: async () => {
      const response = await getRepos();
      return response.repos;
    },
  });

  const {
    data,
    isLoading: chartLoading,
    error: chartError,
  } = useComparison(selectedIds, timeRange, normalize);

  const toggleRepo = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Build unified chart data: [{date, repo1Stars, repo2Stars, ...}]
  const chartData = useMemo(() => {
    if (!data?.repos.length) return [];
    const dateMap = new Map<string, Record<string, number>>();
    for (const repo of data.repos) {
      for (const dp of repo.data_points) {
        const key = dp.date;
        const existing = dateMap.get(key) ?? {};
        existing[`stars_${repo.repo_id}`] = dp.stars;
        dateMap.set(key, existing);
      }
    }
    return Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, ...values }));
  }, [data]);

  const repos = reposQuery.data ?? [];
  const canCompare = selectedIds.length >= 2;

  return (
    <AnimatedPage className="page compare-page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.compare.title}</h1>
        <p className="subtitle">{t.compare.subtitle}</p>
      </header>

      <FadeIn delay={0.1}>
        <RepoSelector repos={repos} selectedIds={selectedIds} onToggle={toggleRepo} t={t} />
      </FadeIn>

      {canCompare && (
        <FadeIn delay={0.15}>
          <div className="compare-controls">
            <div className="compare-time-ranges">
              {TIME_RANGES.map((tr) => (
                <button
                  key={tr}
                  className={`compare-range-btn ${timeRange === tr ? "active" : ""}`}
                  onClick={() => setTimeRange(tr)}
                >
                  {tr}
                </button>
              ))}
            </div>
            <label className="compare-normalize">
              <input
                type="checkbox"
                checked={normalize}
                onChange={(e) => setNormalize(e.target.checked)}
              />
              {t.compare.normalize}
            </label>
          </div>
        </FadeIn>
      )}

      {canCompare && chartLoading && (
        <div className="dashboard-section">
          <Skeleton width="100%" height={300} />
        </div>
      )}

      {canCompare && chartError && <div className="compare-error">{chartError.message}</div>}

      {canCompare && data && (
        <FadeIn delay={0.2}>
          <div className="dashboard-section compare-chart-section">
            {chartData.length === 0 ? (
              <p className="compare-empty">{t.compare.noData}</p>
            ) : (
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  {data.repos.map((repo) => (
                    <Line
                      key={repo.repo_id}
                      type="monotone"
                      dataKey={`stars_${repo.repo_id}`}
                      name={repo.repo_name}
                      stroke={repo.color}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </FadeIn>
      )}

      {canCompare && data && data.repos.length > 0 && (
        <FadeIn delay={0.25}>
          <MetricsTable repos={data.repos} t={t} />
        </FadeIn>
      )}
    </AnimatedPage>
  );
}
