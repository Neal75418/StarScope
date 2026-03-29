/**
 * Star 歷史圖表，使用 Recharts 繪製。
 */

import { useMemo, useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChartDataPoint } from "../api/client";
import { formatNumber, formatChartDate } from "../utils/format";
import { useStarsChart, TimeRange } from "../hooks/useStarsChart";
import { StarHistoryBackfill } from "./StarHistoryBackfill";
import { useI18n } from "../i18n";
import { TIME_RANGES } from "../constants/chart";

/** 圖表渲染高度（px），與 RepoList 的 CHART_EXTRA_HEIGHT 耦合 */
export const STARS_CHART_HEIGHT = 180;

interface StarsChartProps {
  repoId: number;
  currentStars?: number | null;
}

const TOOLTIP_STYLE = {
  backgroundColor: "var(--bg-default, #1a1a1a)",
  border: "1px solid var(--border-default, #333)",
  borderRadius: "4px",
};

/** 從 CSS 變數讀取圖表顏色（Recharts 不支援 var()，需透過 JS 讀取）。 */
function useChartColors() {
  const [colors, setColors] = useState({
    grid: "#333",
    tick: "#888",
    line: "#f0db4f",
    tooltipText: "#fff",
  });
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setColors({
      grid: style.getPropertyValue("--chart-grid").trim() || "#333",
      tick: style.getPropertyValue("--chart-tick").trim() || "#888",
      line: style.getPropertyValue("--chart-line").trim() || "#f0db4f",
      tooltipText: style.getPropertyValue("--chart-tooltip-text").trim() || "#fff",
    });
  }, []);
  return colors;
}

interface TimeRangeSelectorProps {
  current: TimeRange;
  onChange: (range: TimeRange) => void;
  labels: Record<TimeRange, string>;
}

function TimeRangeSelector({ current, onChange, labels }: TimeRangeSelectorProps) {
  return (
    <div className="chart-controls">
      {TIME_RANGES.map((range) => (
        <button
          key={range}
          className={`chart-range-btn ${current === range ? "active" : ""}`}
          onClick={() => onChange(range)}
        >
          {labels[range]}
        </button>
      ))}
    </div>
  );
}

interface ChartColors {
  grid: string;
  tick: string;
  line: string;
  tooltipText: string;
}

interface ChartContentProps {
  data: ChartDataPoint[];
  colors: ChartColors;
}

function ChartContent({ data, colors }: ChartContentProps) {
  const { t } = useI18n();
  return (
    <ResponsiveContainer width="100%" height={STARS_CHART_HEIGHT}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
        <XAxis
          dataKey="date"
          tick={{ fill: colors.tick, fontSize: 11 }}
          tickFormatter={formatChartDate}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: colors.tick, fontSize: 11 }}
          tickFormatter={(value) => formatNumber(value)}
          width={50}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: colors.tooltipText }}
          formatter={(value) => [formatNumber(value as number), t.chart.stars]}
          labelFormatter={(label) => new Date(label).toLocaleDateString()}
        />
        <Line
          type="monotone"
          dataKey="stars"
          stroke={colors.line}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: colors.line }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function StarsChart({ repoId, currentStars }: StarsChartProps) {
  const { data, loading, error, timeRange, setTimeRange, refetch } = useStarsChart(repoId);
  const { t } = useI18n();
  const chartColors = useChartColors();

  const timeRangeLabels = useMemo<Record<TimeRange, string>>(
    () => ({
      "7d": t.chart.timeRange["7d"],
      "30d": t.chart.timeRange["30d"],
      "90d": t.chart.timeRange["90d"],
      all: t.chart.timeRange.all,
    }),
    [t]
  );

  if (loading) {
    return <div className="chart-loading">{t.chart.loading}</div>;
  }

  if (error) {
    return (
      <div className="chart-error">
        {error}
        <button className="btn btn-sm" onClick={() => void refetch()} style={{ marginLeft: 8 }}>
          {t.common.retry}
        </button>
      </div>
    );
  }

  if (data.length < 2) {
    return (
      <div className="stars-chart">
        <div className="chart-empty">{t.chart.insufficientData}</div>
        <StarHistoryBackfill
          repoId={repoId}
          currentStars={currentStars ?? null}
          onBackfillComplete={refetch}
        />
      </div>
    );
  }

  return (
    <div className="stars-chart">
      <TimeRangeSelector current={timeRange} onChange={setTimeRange} labels={timeRangeLabels} />
      <ChartContent data={data} colors={chartColors} />
      <StarHistoryBackfill
        repoId={repoId}
        currentStars={currentStars ?? null}
        onBackfillComplete={refetch}
      />
    </div>
  );
}
