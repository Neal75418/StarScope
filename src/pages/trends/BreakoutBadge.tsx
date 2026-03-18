/**
 * Breakout / Early Signal 標記，顯示在趨勢 repo 旁。
 * 最多顯示 2 個 badge + "+N more"。
 */

import { memo } from "react";
import type { EarlySignal } from "../../api/types";
import { useI18n } from "../../i18n";

interface BreakoutBadgeProps {
  signals: EarlySignal[];
}

export const BreakoutBadge = memo(function BreakoutBadge({ signals }: BreakoutBadgeProps) {
  const { t } = useI18n();
  const labels = t.trends.breakouts.types;

  // 只顯示未 acknowledged 的信號
  const active = signals.filter((s) => !s.acknowledged);
  if (active.length === 0) return null;

  // 依 signal_type 去重
  const uniqueTypes = [...new Set(active.map((s) => s.signal_type))];
  const shown = uniqueTypes.slice(0, 2);
  const moreCount = uniqueTypes.length - shown.length;

  return (
    <span className="breakout-badges" data-testid="breakout-badges">
      {shown.map((type) => {
        const label = labels[type] ?? type;
        return (
          <span
            key={type}
            className={`breakout-badge breakout-badge-${type}`}
            title={active.find((s) => s.signal_type === type)?.description ?? ""}
            aria-label={label}
          >
            {label}
          </span>
        );
      })}
      {moreCount > 0 && (
        <span className="breakout-badge breakout-badge-more">
          {t.trends.breakouts.more.replace("{count}", String(moreCount))}
        </span>
      )}
    </span>
  );
});
