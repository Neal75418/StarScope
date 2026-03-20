/**
 * Portfolio 組合星數歷史折線圖。
 * 顯示所有追蹤 repo 的聚合星數隨時間的變化。
 */

import { memo, useId } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { getPortfolioHistory } from "../../api/client";
import type { PortfolioHistoryPoint, DashboardTimeRange } from "../../api/types";
import { queryKeys } from "../../lib/react-query";
import { formatNumber } from "../../utils/format";
import { Skeleton } from "../Skeleton";
import { useI18n } from "../../i18n";

interface TooltipPayload {
  active?: boolean;
  label?: string;
  payload?: Array<{ value: number; payload: PortfolioHistoryPoint }>;
}

function PortfolioTooltip({ active, label, payload }: TooltipPayload) {
  const { t } = useI18n();
  if (!active || !payload?.length) return null;
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
      <div style={{ color: "var(--fg-muted)", marginBottom: 4 }}>{label}</div>
      <div>
        <strong>{formatNumber(payload[0].value)}</strong> {t.dashboard.portfolioHistory.stars}
      </div>
      <div style={{ color: "var(--fg-muted)", fontSize: 11 }}>
        {payload[0].payload.repo_count} {t.dashboard.portfolioHistory.reposTracked}
      </div>
    </div>
  );
}

// 格式化 X 軸日期，只顯示 M/D
function formatXDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 格式化 Y 軸大數字
function formatYTick(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

interface Props {
  days: DashboardTimeRange;
  onChangeDays: (days: DashboardTimeRange) => void;
}

const TIME_RANGE_OPTIONS: { label: string; value: DashboardTimeRange }[] = [
  { label: "7D", value: 7 },
  { label: "14D", value: 14 },
  { label: "30D", value: 30 },
];

export const PortfolioHistory = memo(function PortfolioHistory({ days, onChangeDays }: Props) {
  const { t } = useI18n();
  const gradientId = useId().replace(/:/g, "");

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.dashboard.portfolioHistory(days),
    queryFn: ({ signal }) => getPortfolioHistory(days, signal),
  });

  return (
    <div className="dashboard-section portfolio-history-section">
      <div className="portfolio-history-header">
        <h3>{t.dashboard.portfolioHistory.title}</h3>
        <div className="dashboard-time-range">
          {TIME_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`time-range-btn${days === opt.value ? " time-range-btn--active" : ""}`}
              onClick={() => onChangeDays(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <Skeleton width="100%" height={160} variant="rounded" style={{ marginTop: 8 }} />
      )}

      {error && (
        <div className="portfolio-history-error">{t.dashboard.portfolioHistory.loadError}</div>
      )}

      {data && data.history.length < 2 && !isLoading && (
        <div className="portfolio-history-empty">{t.dashboard.portfolioHistory.noData}</div>
      )}

      {data && data.history.length >= 2 && (
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data.history} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--accent-fg)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--accent-fg)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis
              dataKey="date"
              tickFormatter={formatXDate}
              tick={{ fontSize: 11, fill: "var(--fg-muted)" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={formatYTick}
              tick={{ fontSize: 11, fill: "var(--fg-muted)" }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip content={<PortfolioTooltip />} />
            <Area
              type="monotone"
              dataKey="total_stars"
              stroke="var(--accent-fg)"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 4, fill: "var(--accent-fg)" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
});
