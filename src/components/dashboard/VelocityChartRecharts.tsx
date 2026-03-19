/**
 * Velocity 分佈長條圖（Recharts 版本）。
 * 取代原本純 CSS 實作，支援 hover tooltip 與動畫效果。
 */

import { memo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useI18n } from "../../i18n";

interface VelocityBarProps {
  data: { key: string; count: number }[];
}

// 依 velocity 等級對應顏色
const VELOCITY_COLORS: Record<string, string> = {
  negative: "var(--danger-fg)",
  low: "var(--fg-muted)",
  medium: "var(--accent-fg)",
  high: "var(--success-fg)",
  veryHigh: "#a371f7",
};

interface TooltipPayload {
  payload?: Array<{ payload: { key: string; count: number } }>;
  active?: boolean;
}

function VelocityTooltip({ active, payload }: TooltipPayload) {
  if (!active || !payload?.length) return null;
  const { count } = payload[0].payload;
  return (
    <div
      style={{
        background: "var(--bg-default)",
        border: "1px solid var(--border-default)",
        borderRadius: 6,
        padding: "8px 12px",
        fontSize: 13,
        color: "var(--fg-default)",
      }}
    >
      <strong>{count}</strong> repos
    </div>
  );
}

export const VelocityChartRecharts = memo(function VelocityChartRecharts({
  data,
}: VelocityBarProps) {
  const { t } = useI18n();

  const chartData = data.map((item) => ({
    ...item,
    label:
      t.dashboard.velocityRanges[item.key as keyof typeof t.dashboard.velocityRanges] ?? item.key,
  }));

  return (
    <div className="dashboard-section">
      <h3>{t.dashboard.velocityDistribution}</h3>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 32, left: 8, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "var(--fg-muted)" }}
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            dataKey="label"
            type="category"
            tick={{ fontSize: 12, fill: "var(--fg-muted)" }}
            width={48}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={<VelocityTooltip />}
            cursor={{ fill: "var(--bg-muted)", opacity: 0.4 }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20}>
            {chartData.map((entry) => (
              <Cell key={entry.key} fill={VELOCITY_COLORS[entry.key] ?? "var(--accent-fg)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});
