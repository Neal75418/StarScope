/**
 * Compare 頁面的指標對比表格，顯示各 repo 的 stars、delta、velocity 等數據。
 */

import { useMemo, memo } from "react";
import { useI18n } from "../../i18n";
import type { ComparisonRepoData, EarlySignal } from "../../api/types";
import { formatNumber, formatDelta } from "../../utils/format";
import { TREND_ARROWS } from "../../constants/trends";
import { BreakoutBadge } from "../trends/BreakoutBadge";

// 指標比較表
export const MetricsTable = memo(function MetricsTable({
  repos,
  t,
  signalsByRepoId,
}: {
  repos: ComparisonRepoData[];
  t: ReturnType<typeof useI18n>["t"];
  signalsByRepoId?: Record<number, EarlySignal[]>;
}) {
  const sorted = useMemo(
    () => [...repos].sort((a, b) => (b.velocity ?? 0) - (a.velocity ?? 0)),
    [repos]
  );

  return (
    <div className="compare-metrics">
      <h3>{t.compare.metrics}</h3>
      <div className="compare-table-wrapper">
        <table className="compare-table">
          <thead>
            <tr>
              <th>{t.compare.columns.repo}</th>
              <th>{t.compare.columns.stars}</th>
              <th>{t.compare.columns.delta7d}</th>
              <th>{t.compare.columns.delta30d}</th>
              <th>{t.compare.columns.velocity}</th>
              <th>{t.compare.columns.acceleration}</th>
              <th>{t.compare.columns.trend}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.repo_id}>
                <td>
                  <span className="compare-color-dot" style={{ background: r.color }} />
                  {r.repo_name}
                  {signalsByRepoId?.[r.repo_id] && (
                    <BreakoutBadge signals={signalsByRepoId[r.repo_id]} />
                  )}
                </td>
                <td>{formatNumber(r.current_stars)}</td>
                <td
                  className={
                    r.stars_delta_7d && r.stars_delta_7d > 0
                      ? "trend-up"
                      : r.stars_delta_7d && r.stars_delta_7d < 0
                        ? "trend-down"
                        : ""
                  }
                >
                  {r.stars_delta_7d != null ? formatDelta(r.stars_delta_7d) : "—"}
                </td>
                <td
                  className={
                    r.stars_delta_30d && r.stars_delta_30d > 0
                      ? "trend-up"
                      : r.stars_delta_30d && r.stars_delta_30d < 0
                        ? "trend-down"
                        : ""
                  }
                >
                  {r.stars_delta_30d != null ? formatDelta(r.stars_delta_30d) : "—"}
                </td>
                <td>{r.velocity != null ? r.velocity.toFixed(1) : "—"}</td>
                <td>{r.acceleration != null ? r.acceleration.toFixed(1) : "—"}</td>
                <td>{r.trend != null ? (TREND_ARROWS[r.trend] ?? "→") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
