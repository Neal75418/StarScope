/**
 * Star history chart using Recharts.
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

interface StarsChartProps {
  repoId: number;
}

const TIME_RANGES: TimeRange[] = ["7d", "30d", "90d"];

const TOOLTIP_STYLE = {
  backgroundColor: "#1a1a1a",
  border: "1px solid #333",
  borderRadius: "4px",
};

interface TimeRangeSelectorProps {
  current: TimeRange;
  onChange: (range: TimeRange) => void;
}

function TimeRangeSelector({ current, onChange }: TimeRangeSelectorProps) {
  return (
    <div className="chart-controls">
      {TIME_RANGES.map((range) => (
        <button
          key={range}
          className={`chart-range-btn ${current === range ? "active" : ""}`}
          onClick={() => onChange(range)}
        >
          {range}
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

export function StarsChart({ repoId }: StarsChartProps) {
  const { data, loading, error, timeRange, setTimeRange } = useStarsChart(repoId);

  if (loading) {
    return <div className="chart-loading">Loading chart...</div>;
  }

  if (error) {
    return <div className="chart-error">{error}</div>;
  }

  if (data.length < 2) {
    return (
      <div className="chart-empty">Not enough data for chart. Need at least 2 data points.</div>
    );
  }

  return (
    <div className="stars-chart">
      <TimeRangeSelector current={timeRange} onChange={setTimeRange} />
      <ChartContent data={data} />
    </div>
  );
}
