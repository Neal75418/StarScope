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
import { useI18n, interpolate } from "../i18n";
import { useComparison } from "../hooks/useComparison";
import { useReposQuery } from "../hooks/useReposQuery";
import { useTrendEarlySignals } from "../hooks/useTrendEarlySignals";
import type { ComparisonTimeRange, ChartDataPoint } from "../api/types";
import { AnimatedPage, FadeIn } from "../components/motion";
import { Skeleton } from "../components/Skeleton";
import { TIME_RANGES } from "../constants/chart";
import { STORAGE_KEYS } from "../constants/storage";
import { RepoSelector, MAX_COMPARE_REPOS, type RepoSelectorHandle } from "./compare/RepoSelector";
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
    const ids: number[] = saved ? JSON.parse(saved) : [];
    return ids.slice(0, MAX_COMPARE_REPOS);
  } catch {
    return [];
  }
}

// 主元件
export function Compare() {
  const { t } = useI18n();
  const [selectedIds, setSelectedIds] = useState<number[]>(loadSavedRepoIds);
  const [timeRange, setTimeRange] = useState<ComparisonTimeRange>("30d");
  // 預設開啟：這頁的副標寫的是「比較…趨勢」，而趨勢是形狀。不正規化時
  // 兩個規模差 6 倍的 repo 只會畫出兩條平行的水平線——實測資料線的垂直
  // 跨度只有 0px 與 0.2px（繪圖區 289px），第一眼沒有任何資訊。
  // 絕對值沒有因此消失：摘要卡仍然給「領先者 223.9K」與「星數差距 185.1K」
  const [normalize, setNormalize] = useState(true);
  const [metric, setMetric] = useState<CompareMetric>("stars");
  const [chartType, setChartType] = useState<CompareChartType>("line");
  const chartRef = useRef<HTMLDivElement>(null);
  const selectorRef = useRef<RepoSelectorHandle>(null);

  const reposQuery = useReposQuery();

  // reconcile：當 watchlist repos 變動時，裁切掉已不存在的 orphan IDs
  const availableRepoIds = useMemo(
    () => new Set((reposQuery.data ?? []).map((r) => r.id)),
    [reposQuery.data]
  );
  useEffect(() => {
    // query 尚未回傳（data === undefined）時跳過，避免誤清
    // data === []（watchlist 真的空了）時則正確 prune 全部
    if (reposQuery.data === undefined) return;
    setSelectedIds((prev) => {
      const pruned = prev.filter((id) => availableRepoIds.has(id));
      if (pruned.length === prev.length) return prev;
      try {
        localStorage.setItem(STORAGE_KEYS.COMPARE_REPOS, JSON.stringify(pruned));
      } catch {
        // QuotaExceededError — 靜默忽略
      }
      return pruned;
    });
  }, [availableRepoIds, reposQuery.data]);

  const {
    data,
    isLoading: chartLoading,
    error: chartError,
    refetch,
  } = useComparison(selectedIds, timeRange, normalize);

  // ?? 0：這只是一行提示，不值得為它讓整頁掛掉——開發時前端可能比 sidecar 新，
  // 那時回應裡沒有這個欄位
  const skippedArchivedCount = data?.skipped_archived?.length ?? 0;

  const { signalsByRepoId } = useTrendEarlySignals(selectedIds);
  const { navigateTo, navigationState, consumeNavigationState } = useNavigation();

  // mount 時消費 NavigationContext 的 preselectedIds
  const consumedRef = useRef(false);
  useEffect(() => {
    if (consumedRef.current) return;
    if (!navigationState?.preselectedIds) return;
    consumedRef.current = true;

    const ids = navigationState.preselectedIds as number[];
    if (ids.length > 0) {
      setSelectedIds((prev) => {
        const merged = Array.from(new Set([...prev, ...ids])).slice(0, MAX_COMPARE_REPOS);
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

  // RepoSelector 是 memo(forwardRef(...))：inline arrow 每次 render 都是新引用，
  // 會讓 memo 永遠 miss，切換 metric/時間範圍時整份 repo chip 清單跟著重繪。
  const handleGoDiscover = useCallback(() => navigateTo("discovery"), [navigateTo]);

  const toggleRepo = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_COMPARE_REPOS
          ? prev
          : [...prev, id];
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
  type ChartRow = { date: string; [key: string]: string | number | null };
  const chartData = useMemo<ChartRow[]>(() => {
    if (!data?.repos.length) return [];
    const getMetricValue = (dp: ChartDataPoint) =>
      metric === "issues" ? dp.open_issues : dp[metric];
    const dateMap = new Map<string, Record<string, number | null>>();
    for (const repo of data.repos) {
      for (const dp of repo.data_points) {
        const key = dp.date;
        const existing = dateMap.get(key) ?? {};
        // null 照原樣傳給 Recharts：它會把該點斷開，而不是畫成 0
        existing[`${metric}_${repo.repo_id}`] = getMetricValue(dp);
        dateMap.set(key, existing);
      }
    }
    return Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, ...values }));
  }, [data, metric]);

  // 按下「30 天」時後端回的是「今天往前 30 天內的資料」——那些按鈕沒有壞，
  // 只是新裝的資料庫還沒累積那麼久，四個按鈕會給出同一張圖。停用它們是錯的
  // （「全部」永遠有意義），正確的做法是把實際涵蓋的天數講出來
  const coverage = useMemo(() => {
    const dates = chartData.map((row) => row.date as string).sort();
    if (dates.length < 2) return null;
    const span =
      Math.round(
        (Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) /
          86_400_000
      ) + 1;
    // 「全部」的意思就是「你有的通通給我」，涵蓋範圍不可能少於要求，所以不提示。
    // 這行拿掉的話 requested 會是 undefined、`span < undefined` 恆為 false，
    // 行為其實一樣——留著是把意圖寫明，順便讓下面的 map 查表在型別上是完整的
    if (timeRange === "all") return null;
    const requested = { "7d": 7, "30d": 30, "90d": 90 }[timeRange];
    return span < requested ? span : null;
  }, [chartData, timeRange]);

  // 正規化算的是 (現值-基期)/基期，基期為 0 就算不出來，後端回 null，
  // Recharts 於是整條線都不畫——圖例還列著它，看起來像圖表壞了。
  // 把「哪個 repo 在這個指標下沒有百分比」講出來
  const uncomputableNames = useMemo(() => {
    if (!normalize || !data?.repos.length) return [];
    const key = metric === "issues" ? "open_issues" : metric;
    return data.repos
      .filter((r) => r.data_points.length > 0 && r.data_points.every((dp) => dp[key] === null))
      .map((r) => r.repo_name);
  }, [data, metric, normalize]);

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
          onGoDiscover={handleGoDiscover}
          t={t}
        />
      </FadeIn>

      {canCompare && (
        <FadeIn delay={0.15}>
          <div className="compare-controls">
            <div className="compare-time-ranges" role="group" aria-label={t.compare.timeRange}>
              {TIME_RANGES.map((tr) => (
                <button
                  key={tr}
                  className={`compare-range-btn ${timeRange === tr ? "active" : ""}`}
                  onClick={() => setTimeRange(tr)}
                  aria-pressed={timeRange === tr}
                >
                  {t.compare.timeRangeLabels[tr]}
                </button>
              ))}
            </div>

            <div
              className="compare-metric-toggle"
              data-testid="compare-metric-toggle"
              role="group"
              aria-label={t.compare.metric.title}
            >
              <button
                className={`btn btn-sm ${metric === "stars" ? "active" : ""}`}
                onClick={() => setMetric("stars")}
                aria-pressed={metric === "stars"}
              >
                {t.compare.metric.stars}
              </button>
              <button
                className={`btn btn-sm ${metric === "forks" ? "active" : ""}`}
                onClick={() => setMetric("forks")}
                aria-pressed={metric === "forks"}
              >
                {t.compare.metric.forks}
              </button>
              <button
                className={`btn btn-sm ${metric === "issues" ? "active" : ""}`}
                onClick={() => setMetric("issues")}
                aria-pressed={metric === "issues"}
              >
                {t.compare.metric.issues}
              </button>
            </div>

            <div
              className="compare-chart-type-toggle"
              data-testid="compare-chart-type-toggle"
              role="group"
              aria-label={t.compare.chartType.title}
            >
              <button
                className={`btn btn-sm ${chartType === "line" ? "active" : ""}`}
                onClick={() => setChartType("line")}
                aria-pressed={chartType === "line"}
              >
                {t.compare.chartType.line}
              </button>
              <button
                className={`btn btn-sm ${chartType === "area" ? "active" : ""}`}
                onClick={() => setChartType("area")}
                aria-pressed={chartType === "area"}
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
            {coverage !== null && (
              <p className="compare-coverage-note">
                {interpolate(t.compare.coverageNote, { days: String(coverage) })}
              </p>
            )}
            {uncomputableNames.length > 0 && (
              <p className="compare-coverage-note">
                {interpolate(t.compare.zeroBaseNote, { repos: uncomputableNames.join("、") })}
              </p>
            )}
            {chartData.length === 0 ? (
              <p className="compare-empty">{t.compare.noData}</p>
            ) : (
              <ResponsiveContainer width="100%" height={350}>
                {chartType === "line" ? (
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: number) => (normalize ? `${v}%` : String(v))}
                    />
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
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: number) => (normalize ? `${v}%` : String(v))}
                    />
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

      {/* 後端刻意回報被略過的封存成員，而不是整批 404。前端若丟掉這個欄位，
          使用者只會看到圖表少一條線而沒有任何說明 */}
      {skippedArchivedCount > 0 && (
        <p className="compare-skipped-note" data-testid="compare-skipped-archived">
          {interpolate(t.compare.skippedArchived, { count: skippedArchivedCount })}
        </p>
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
