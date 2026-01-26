/**
 * Comparison chart showing star history for multiple repos.
 */

import { useState, useEffect, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { ComparisonChartData, getComparisonChart } from "../../api/client";
import { formatNumber, formatChartDate } from "../../utils/format";
import { useI18n } from "../../i18n";

interface ComparisonChartProps {
  groupId: number;
}

type TimeRange = "7d" | "30d" | "90d";

const TIME_RANGES: TimeRange[] = ["7d", "30d", "90d"];

const TOOLTIP_STYLE = {
  backgroundColor: "#1a1a1a",
  border: "1px solid #333",
  borderRadius: "4px",
};

// Colors for different repos
const CHART_COLORS = [
  "#f0db4f", // yellow
  "#61dafb", // cyan
  "#ff6b6b", // red
  "#4ecdc4", // teal
  "#95e1d3", // mint
  "#f38181", // coral
  "#aa96da", // lavender
  "#fcbad3", // pink
];

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

export function ComparisonChart({ groupId }: ComparisonChartProps) {
  const { t } = useI18n();
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [chartData, setChartData] = useState<ComparisonChartData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadChart = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getComparisonChart(groupId, timeRange);
      setChartData(data);
    } catch (err) {
      console.error("Failed to load comparison chart:", err);
      setError(t.compare.loadingError);
    } finally {
      setIsLoading(false);
    }
  }, [groupId, timeRange, t]);

  useEffect(() => {
    void loadChart();
  }, [loadChart]);

  if (isLoading) {
    return <div className="chart-loading">{t.common.loading}</div>;
  }

  if (error) {
    return <div className="chart-error">{error}</div>;
  }

  if (!chartData || chartData.series.length === 0) {
    return null;
  }

  // Transform data for Recharts
  const formattedData = chartData.dates.map((date, index) => {
    const point: Record<string, string | number | null> = { date };
    chartData.series.forEach((series) => {
      point[series.full_name] = series.data[index];
    });
    return point;
  });

  return (
    <div className="comparison-chart">
      <div className="chart-header">
        <h3>{t.compare.chart?.title ?? "Star History"}</h3>
        <TimeRangeSelector current={timeRange} onChange={setTimeRange} />
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={formattedData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
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
            width={60}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#fff" }}
            formatter={(value) => [formatNumber(value as number), "Stars"]}
            labelFormatter={(label) => new Date(label).toLocaleDateString()}
          />
          <Legend />
          {chartData.series.map((series, index) => (
            <Line
              key={series.repo_id}
              type="monotone"
              dataKey={series.full_name}
              name={series.full_name}
              stroke={CHART_COLORS[index % CHART_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
