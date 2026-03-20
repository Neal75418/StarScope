/**
 * 對比頁面 — 多 repo 星數/forks 趨勢對比。
 */

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
  ResponsiveContainer,
} from "recharts";
import { useI18n } from "../i18n";
import { useComparison } from "../hooks/useComparison";
import { useReposQuery } from "../hooks/useReposQuery";
import { useTrendEarlySignals } from "../hooks/useTrendEarlySignals";
import type { ComparisonTimeRange } from "../api/types";
import { AnimatedPage, FadeIn } from "../components/motion";
import { Skeleton } from "../components/Skeleton";
import { TIME_RANGES } from "../constants/chart";
import { STORAGE_KEYS } from "../constants/storage";
import { RepoSelector, type RepoSelectorHandle } from "./compare/RepoSelector";
import { MetricsTable } from "./compare/MetricsTable";
import { CompareTooltip } from "./compare/CompareTooltip";
import { ChartDownloadButton } from "./compare/ChartDownloadButton";
import { DiffSummaryPanel } from "./compare/DiffSummaryPanel";
import { useNavigation } from "../contexts/NavigationContext";

export type CompareMetric = "stars" | "forks" | "issues";
export type CompareChartType = "line" | "area";

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
  const [metric, setMetric] = useState<CompareMetric>("stars");
  const [chartType, setChartType] = useState<CompareChartType>("line");
  const chartRef = useRef<HTMLDivElement>(null);
  const selectorRef = useRef<RepoSelectorHandle>(null);

  const reposQuery = useReposQuery();

  const {
    data,
    isLoading: chartLoading,
    error: chartError,
    refetch,
  } = useComparison(selectedIds, timeRange, normalize);

  const { signalsByRepoId } = useTrendEarlySignals(selectedIds);
  const { navigationState, consumeNavigationState } = useNavigation();

  // mount 時消費 NavigationContext 的 preselectedIds
  const consumedRef = useRef(false);
  useEffect(() => {
    if (consumedRef.current) return;
    if (!navigationState?.preselectedIds) return;
    consumedRef.current = true;

    const ids = navigationState.preselectedIds as number[];
    if (ids.length > 0) {
      setSelectedIds((prev) => {
        const merged = Array.from(new Set([...prev, ...ids]));
        try {
          localStorage.setItem(STORAGE_KEYS.COMPARE_REPOS, JSON.stringify(merged));
        } catch {
          // QuotaExceededError — 靜默忽略
        }
        return merged;
      });
    }
    consumeNavigationState();
  }, [navigationState, consumeNavigationState]);

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

  const canCompare = selectedIds.length >= 2;

  // 建構統一圖表資料：[{date, metric_repoId, ...}]
  type ChartRow = { date: string; [key: string]: string | number };
  const chartData = useMemo<ChartRow[]>(() => {
    if (!data?.repos.length) return [];
    const getMetricValue = (dp: { stars: number; forks: number; open_issues: number }) =>
      metric === "issues" ? dp.open_issues : dp[metric];
    const dateMap = new Map<string, Record<string, number>>();
    for (const repo of data.repos) {
      for (const dp of repo.data_points) {
        const key = dp.date;
        const existing = dateMap.get(key) ?? {};
        existing[`${metric}_${repo.repo_id}`] = getMetricValue(dp);
        dateMap.set(key, existing);
      }
    }
    return Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, ...values }));
  }, [data, metric]);

  const repos = reposQuery.data ?? [];
  const showBrush = chartData.length > 14;

  return (
    <AnimatedPage className="page compare-page">
      <header className="page-header">
        <h1 data-testid="page-title">{t.compare.title}</h1>
        <p className="subtitle">{t.compare.subtitle}</p>
      </header>

      <FadeIn delay={0.1}>
        <RepoSelector
          ref={selectorRef}
          repos={repos}
          selectedIds={selectedIds}
          onToggle={toggleRepo}
          t={t}
        />
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

            <div className="compare-metric-toggle" data-testid="compare-metric-toggle">
              <button
                className={`btn btn-sm ${metric === "stars" ? "active" : ""}`}
                onClick={() => setMetric("stars")}
              >
                {t.compare.metric.stars}
              </button>
              <button
                className={`btn btn-sm ${metric === "forks" ? "active" : ""}`}
                onClick={() => setMetric("forks")}
              >
                {t.compare.metric.forks}
              </button>
              <button
                className={`btn btn-sm ${metric === "issues" ? "active" : ""}`}
                onClick={() => setMetric("issues")}
              >
                {t.compare.metric.issues}
              </button>
            </div>

            <div className="compare-chart-type-toggle" data-testid="compare-chart-type-toggle">
              <button
                className={`btn btn-sm ${chartType === "line" ? "active" : ""}`}
                onClick={() => setChartType("line")}
              >
                {t.compare.chartType.line}
              </button>
              <button
                className={`btn btn-sm ${chartType === "area" ? "active" : ""}`}
                onClick={() => setChartType("area")}
              >
                {t.compare.chartType.area}
              </button>
            </div>

            <label className="compare-normalize">
              <input
                type="checkbox"
                checked={normalize}
                onChange={(e) => setNormalize(e.target.checked)}
              />
              {t.compare.normalize}
            </label>

            <ChartDownloadButton chartRef={chartRef} />
          </div>
        </FadeIn>
      )}

      {canCompare && chartLoading && (
        <div className="dashboard-section">
          <Skeleton width="100%" height={300} />
        </div>
      )}

      {canCompare && chartError && (
        <div className="compare-error" role="alert">
          <p>{chartError.message}</p>
          <button className="btn btn-sm" onClick={() => refetch()} data-testid="compare-retry-btn">
            {t.compare.retry}
          </button>
        </div>
      )}

      {canCompare && data && (
        <FadeIn delay={0.2}>
          <div className="dashboard-section compare-chart-section" ref={chartRef}>
            {chartData.length === 0 ? (
              <p className="compare-empty">{t.compare.noData}</p>
            ) : (
              <ResponsiveContainer width="100%" height={350}>
                {chartType === "line" ? (
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<CompareTooltip normalize={normalize} />} />
                    <Legend />
                    {data.repos.map((repo) => (
                      <Line
                        key={repo.repo_id}
                        type="monotone"
                        dataKey={`${metric}_${repo.repo_id}`}
                        name={repo.repo_name}
                        stroke={repo.color}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                    {showBrush && (
                      <Brush
                        dataKey="date"
                        height={30}
                        stroke="var(--accent-fg)"
                        fill="var(--bg-subtle)"
                      />
                    )}
                  </LineChart>
                ) : (
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<CompareTooltip normalize={normalize} />} />
                    <Legend />
                    {data.repos.map((repo) => (
                      <Area
                        key={repo.repo_id}
                        type="monotone"
                        dataKey={`${metric}_${repo.repo_id}`}
                        name={repo.repo_name}
                        stroke={repo.color}
                        fill={repo.color}
                        fillOpacity={0.15}
                        strokeWidth={2}
                        connectNulls
                      />
                    ))}
                    {showBrush && (
                      <Brush
                        dataKey="date"
                        height={30}
                        stroke="var(--accent-fg)"
                        fill="var(--bg-subtle)"
                      />
                    )}
                  </AreaChart>
                )}
              </ResponsiveContainer>
            )}
          </div>
        </FadeIn>
      )}

      {canCompare && data && data.repos.length > 0 && (
        <FadeIn delay={0.25}>
          <DiffSummaryPanel repos={data.repos} />
          <MetricsTable repos={data.repos} t={t} signalsByRepoId={signalsByRepoId} />
        </FadeIn>
      )}
    </AnimatedPage>
  );
}
