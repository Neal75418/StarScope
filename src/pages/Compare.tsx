/**
 * 對比頁面 — 多 repo 星數趨勢對比。
 */

import { useState, useMemo, useCallback } from "react";
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
import { useReposQuery } from "../hooks/useReposQuery";
import type { ComparisonTimeRange } from "../api/types";
import { AnimatedPage, FadeIn } from "../components/motion";
import { Skeleton } from "../components/Skeleton";
import { TIME_RANGES } from "../constants/chart";
import { STORAGE_KEYS } from "../constants/storage";
import { RepoSelector } from "./compare/RepoSelector";
import { MetricsTable } from "./compare/MetricsTable";

function loadSavedRepoIds(): number[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.COMPARE_REPOS);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

// ==================== 主元件 ====================
export function Compare() {
  const { t } = useI18n();
  const [selectedIds, setSelectedIds] = useState<number[]>(loadSavedRepoIds);
  const [timeRange, setTimeRange] = useState<ComparisonTimeRange>("30d");
  const [normalize, setNormalize] = useState(false);

  const reposQuery = useReposQuery();

  const {
    data,
    isLoading: chartLoading,
    error: chartError,
  } = useComparison(selectedIds, timeRange, normalize);

  const toggleRepo = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(STORAGE_KEYS.COMPARE_REPOS, JSON.stringify(next));
      } catch {
        // QuotaExceededError — 靜默忽略
      }
      return next;
    });
  }, []);

  // 建構統一圖表資料：[{date, repo1Stars, repo2Stars, ...}]
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
