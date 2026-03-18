/**
 * Compare URL 同步：將 repo IDs、時間範圍、指標等序列化到 URL hash。
 * Hash 格式：#c:repos=1,2,3&range=30d&norm=1&metric=forks&chart=area
 */

import { useEffect, useRef, useState } from "react";
import type { ComparisonTimeRange } from "../api/types";
import type { CompareMetric, CompareChartType } from "../pages/Compare";

const HASH_PREFIX = "c:";

export interface CompareUrlState {
  repoIds: number[];
  timeRange: ComparisonTimeRange;
  normalize: boolean;
  metric: CompareMetric;
  chartType: CompareChartType;
  logScale: boolean;
  showGrowthRate: boolean;
}

interface UseCompareUrlOptions {
  repoIds: number[];
  timeRange: ComparisonTimeRange;
  normalize: boolean;
  metric: CompareMetric;
  chartType: CompareChartType;
  logScale: boolean;
  showGrowthRate: boolean;
  onRestoreState: (state: CompareUrlState) => void;
}

const VALID_TIME_RANGES: Set<string> = new Set(["7d", "30d", "90d", "all"]);
const VALID_METRICS: Set<string> = new Set(["stars", "forks", "issues"]);
const VALID_CHART_TYPES: Set<string> = new Set(["line", "area"]);

function serializeToHash(state: CompareUrlState): string {
  const params = new URLSearchParams();
  if (state.repoIds.length > 0) params.set("repos", state.repoIds.join(","));
  if (state.timeRange !== "30d") params.set("range", state.timeRange);
  if (state.normalize) params.set("norm", "1");
  if (state.metric !== "stars") params.set("metric", state.metric);
  if (state.chartType !== "line") params.set("chart", state.chartType);
  if (state.logScale) params.set("log", "1");
  if (state.showGrowthRate) params.set("growth", "1");

  const str = params.toString();
  return str ? `#${HASH_PREFIX}${str}` : "";
}

function deserializeFromHash(hash: string): CompareUrlState | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(HASH_PREFIX)) return null;

  const paramStr = raw.slice(HASH_PREFIX.length);
  if (!paramStr) return null;

  const params = new URLSearchParams(paramStr);
  if (params.size === 0) return null;

  const reposRaw = params.get("repos") ?? "";
  const repoIds = reposRaw
    ? reposRaw
        .split(",")
        .map(Number)
        .filter((n) => !isNaN(n) && n > 0)
    : [];

  const rangeRaw = params.get("range") ?? "30d";
  const timeRange: ComparisonTimeRange = VALID_TIME_RANGES.has(rangeRaw)
    ? (rangeRaw as ComparisonTimeRange)
    : "30d";

  const normalize = params.get("norm") === "1";

  const metricRaw = params.get("metric") ?? "stars";
  const metric: CompareMetric = VALID_METRICS.has(metricRaw)
    ? (metricRaw as CompareMetric)
    : "stars";

  const chartRaw = params.get("chart") ?? "line";
  const chartType: CompareChartType = VALID_CHART_TYPES.has(chartRaw)
    ? (chartRaw as CompareChartType)
    : "line";

  const logScale = params.get("log") === "1";
  const showGrowthRate = params.get("growth") === "1";

  return { repoIds, timeRange, normalize, metric, chartType, logScale, showGrowthRate };
}

export function useCompareUrl({
  repoIds,
  timeRange,
  normalize,
  metric,
  chartType,
  logScale,
  showGrowthRate,
  onRestoreState,
}: UseCompareUrlOptions) {
  const isSyncingRef = useRef(false);
  const [hasUrlParams, setHasUrlParams] = useState(false);
  const initializedRef = useRef(false);
  const restoreRef = useRef(onRestoreState);
  restoreRef.current = onRestoreState;

  // 初始化：mount 時如果 hash 有 compare 參數 → 恢復狀態
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const restored = deserializeFromHash(window.location.hash);
    if (restored) {
      setHasUrlParams(true);
      isSyncingRef.current = true;
      restoreRef.current(restored);
      queueMicrotask(() => {
        isSyncingRef.current = false;
      });
    }
  }, []);

  // State → URL
  useEffect(() => {
    if (isSyncingRef.current) return;

    const hasState =
      repoIds.length > 0 ||
      timeRange !== "30d" ||
      normalize ||
      metric !== "stars" ||
      chartType !== "line" ||
      logScale ||
      showGrowthRate;

    if (!hasState) {
      if (window.location.hash.startsWith(`#${HASH_PREFIX}`)) {
        window.history.replaceState(null, "", window.location.pathname);
      }
      return;
    }

    const newHash = serializeToHash({
      repoIds,
      timeRange,
      normalize,
      metric,
      chartType,
      logScale,
      showGrowthRate,
    });
    const currentHash = window.location.hash || "";
    if (newHash !== currentHash) {
      window.history.replaceState(null, "", newHash || window.location.pathname);
    }
  }, [repoIds, timeRange, normalize, metric, chartType, logScale, showGrowthRate]);

  // hashchange 事件
  useEffect(() => {
    function handleHashChange() {
      if (isSyncingRef.current) return;

      const restored = deserializeFromHash(window.location.hash);
      if (restored) {
        isSyncingRef.current = true;
        restoreRef.current(restored);
        requestAnimationFrame(() => {
          isSyncingRef.current = false;
        });
      }
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return { hasUrlParams };
}

// 匯出 helper 以便測試
export { serializeToHash as _serializeToHash, deserializeFromHash as _deserializeFromHash };
