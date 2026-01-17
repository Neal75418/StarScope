/**
 * Star history chart using Recharts.
 */

import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { getStarsChart, ChartDataPoint } from "../api/client";
import { formatNumber } from "../utils/format";

interface StarsChartProps {
  repoId: number;
}

type TimeRange = "7d" | "30d" | "90d";

export function StarsChart({ repoId }: StarsChartProps) {
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await getStarsChart(repoId, timeRange);
        if (isMounted) {
          setData(response.data_points);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load chart");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [repoId, timeRange]);

  if (loading) {
    return <div className="chart-loading">Loading chart...</div>;
  }

  if (error) {
    return <div className="chart-error">{error}</div>;
  }

  if (data.length < 2) {
    return (
      <div className="chart-empty">
        Not enough data for chart. Need at least 2 data points.
      </div>
    );
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  return (
    <div className="stars-chart">
      <div className="chart-controls">
        {(["7d", "30d", "90d"] as TimeRange[]).map((range) => (
          <button
            key={range}
            className={`chart-range-btn ${timeRange === range ? "active" : ""}`}
            onClick={() => setTimeRange(range)}
          >
            {range}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            dataKey="date"
            tick={{ fill: "#888", fontSize: 11 }}
            tickFormatter={formatDate}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: "#888", fontSize: 11 }}
            tickFormatter={(value) => formatNumber(value)}
            width={50}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: "4px",
            }}
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
    </div>
  );
}
