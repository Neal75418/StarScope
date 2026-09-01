/**
 * Velocity 分佈長條圖（Recharts）。
 * 支援 hover tooltip 與動畫效果。
 */

import { memo, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Rectangle,
  LabelList,
} from "recharts";
import type { BarShapeProps } from "recharts";
import { useI18n } from "../../i18n";
import { barChartMinHeight } from "./chartLayout";

interface VelocityBarProps {
  data: { key: string; count: number }[];
}

// 依 velocity 等級對應顏色
const VELOCITY_COLORS: Record<string, string> = {
  negative: "var(--danger-fg)",
  low: "var(--fg-muted)",
  medium: "var(--accent-fg)",
  high: "var(--success-fg)",
  veryHigh: "var(--accent-emphasis)",
  // 「資料不足」不是一個成長區間，用比 low 更弱的灰，才不會被讀成一種成績
  unknown: "var(--border-default)",
};

interface TooltipPayload {
  payload?: Array<{ payload: { key: string; count: number } }>;
  active?: boolean;
}

function VelocityTooltip({ active, payload }: TooltipPayload) {
  const { t } = useI18n();
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
      <strong>{count}</strong> {t.dashboard.velocityChart.repos}
    </div>
  );
}

export const VelocityChartRecharts = memo(function VelocityChartRecharts({
  data,
}: VelocityBarProps) {
  const { t } = useI18n();

  const chartData = useMemo(
    () =>
      data.map((item) => ({
        ...item,
        label:
          t.dashboard.velocityRanges[item.key as keyof typeof t.dashboard.velocityRanges] ??
          item.key,
      })),
    [data, t]
  );

  return (
    <div className="dashboard-section dashboard-section--chart">
      <h3>{t.dashboard.velocityDistribution}</h3>
      <div
        className="dashboard-chart-fill"
        style={{ minHeight: barChartMinHeight(chartData.length) }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 40, left: 8, bottom: 0 }}
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
            {/* isAnimationActive={false}：Recharts 要等長條動畫跑完才畫 LabelList。
                旁邊的語言分佈同理，兩張圖的數字要一起出現 */}
            <Bar
              dataKey="count"
              radius={[0, 4, 4, 0]}
              maxBarSize={20}
              isAnimationActive={false}
              // shape 取代 Cell（Cell 在 Recharts 4 會被移除）
              shape={(props: BarShapeProps) => {
                const entry = chartData[props.index];
                return (
                  <Rectangle {...props} fill={VELOCITY_COLORS[entry.key] ?? "var(--accent-fg)"} />
                );
              }}
            >
              {/* 數量直接標在長條末端；tooltip 留著是因為它多說了單位（N 個儲存庫） */}
              <LabelList
                dataKey="count"
                position="right"
                style={{ fill: "var(--fg-muted)", fontSize: 11 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
