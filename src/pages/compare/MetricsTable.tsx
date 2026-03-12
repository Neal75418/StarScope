import { useMemo, memo } from "react";
import { useI18n } from "../../i18n";
import type { ComparisonRepoData } from "../../api/types";
import { formatNumber, formatDelta } from "../../utils/format";
import { TREND_ARROWS } from "../../constants/trends";

// --- MetricsTable ---
export const MetricsTable = memo(function MetricsTable({
  repos,
  t,
}: {
  repos: ComparisonRepoData[];
  t: ReturnType<typeof useI18n>["t"];
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
