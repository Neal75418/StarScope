/**
 * Star 歷史圖表，使用 Recharts 繪製。
 */

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

interface StarsChartProps {
  repoId: number;
  currentStars?: number | null;
}

const TIME_RANGES: TimeRange[] = ["7d", "30d", "90d", "all"];

const TOOLTIP_STYLE = {
  backgroundColor: "var(--bg-default, #1a1a1a)",
  border: "1px solid var(--border-default, #333)",
  borderRadius: "4px",
};

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

interface ChartContentProps {
  data: ChartDataPoint[];
}

function ChartContent({ data }: ChartContentProps) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#888", fontSize: 11 }}
          tickFormatter={formatChartDate}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: "#888", fontSize: 11 }}
          tickFormatter={(value) => formatNumber(value)}
          width={50}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: "#fff" }}
          formatter={(value) => [formatNumber(value as number), "Stars"]}
          labelFormatter={(label) => new Date(label).toLocaleDateString()}
        />
        <Line
          type="monotone"
          dataKey="stars"
          stroke="#f0db4f"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "#f0db4f" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function StarsChart({ repoId, currentStars }: StarsChartProps) {
  const { data, loading, error, timeRange, setTimeRange, refetch } = useStarsChart(repoId);
  const { t } = useI18n();

  const timeRangeLabels: Record<TimeRange, string> = {
    "7d": t.chart.timeRange["7d"],
    "30d": t.chart.timeRange["30d"],
    "90d": t.chart.timeRange["90d"],
    all: t.chart.timeRange.all,
  };

  if (loading) {
    return <div className="chart-loading">{t.chart.loading}</div>;
  }

  if (error) {
    return <div className="chart-error">{error}</div>;
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
      <ChartContent data={data} />
      <StarHistoryBackfill
        repoId={repoId}
        currentStars={currentStars ?? null}
        onBackfillComplete={refetch}
      />
    </div>
  );
}
