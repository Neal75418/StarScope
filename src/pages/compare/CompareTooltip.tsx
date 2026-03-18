/**
 * 自訂 recharts Tooltip，顯示日期 + 每個 repo 的值（含色點）。
 */

import { memo } from "react";

interface PayloadEntry {
  name: string;
  value: number;
  color: string;
  dataKey?: string;
}

interface CompareTooltipProps {
  active?: boolean;
  payload?: PayloadEntry[];
  label?: string;
  normalize: boolean;
}

export const CompareTooltip = memo(function CompareTooltip({
  active,
  payload,
  label,
  normalize,
}: CompareTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="compare-tooltip" data-testid="compare-tooltip">
      <p className="compare-tooltip-date">{label}</p>
      {payload.map((entry) => {
        const isGrowth = entry.dataKey?.toString().startsWith("growth_");
        return (
          <div key={entry.name} className="compare-tooltip-row">
            <span className="compare-tooltip-dot" style={{ background: entry.color }} />
            <span className="compare-tooltip-name">{entry.name}</span>
            <span className="compare-tooltip-value">
              {typeof entry.value === "number"
                ? isGrowth
                  ? `${entry.value >= 0 ? "+" : ""}${entry.value.toFixed(1)}/d`
                  : `${entry.value.toLocaleString()}${normalize ? "%" : ""}`
                : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
});
