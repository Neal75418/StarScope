/**
 * Correlation Matrix — Pearson correlation NxN 表格。
 * 只在 repos >= 2 且 data_points >= 7 時顯示。
 */

import { useMemo, memo } from "react";
import type { ComparisonRepoData } from "../../api/types";
import { useI18n } from "../../i18n";
import type { CompareMetric } from "../Compare";

interface CorrelationMatrixProps {
  repos: ComparisonRepoData[];
  metric: CompareMetric;
}

/**
 * 計算 Pearson correlation coefficient。
 * 如果任何一邊方差為零，返回 NaN。
 */
function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;

  let sumX = 0,
    sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let covXY = 0,
    varX = 0,
    varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    covXY += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  if (varX === 0 || varY === 0) return NaN;
  return covXY / Math.sqrt(varX * varY);
}

/**
 * 根據 correlation 值回傳色標 CSS class。
 */
function correlationClass(r: number): string {
  if (isNaN(r)) return "corr-na";
  if (r >= 0.7) return "corr-strong-pos";
  if (r >= 0.3) return "corr-weak-pos";
  if (r > -0.3) return "corr-neutral";
  if (r > -0.7) return "corr-weak-neg";
  return "corr-strong-neg";
}

export const CorrelationMatrix = memo(function CorrelationMatrix({
  repos,
  metric,
}: CorrelationMatrixProps) {
  const { t } = useI18n();

  // 提取每個 repo 的 metric 時間序列
  const seriesMap = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const repo of repos) {
      map.set(
        repo.repo_id,
        repo.data_points.map((dp) => (metric === "issues" ? dp.open_issues : dp[metric]))
      );
    }
    return map;
  }, [repos, metric]);

  // 計算 NxN correlation matrix
  const matrix = useMemo(() => {
    const result: number[][] = [];
    for (const repoA of repos) {
      const row: number[] = [];
      const seriesA = seriesMap.get(repoA.repo_id) ?? [];
      for (const repoB of repos) {
        if (repoA.repo_id === repoB.repo_id) {
          row.push(1);
        } else {
          const seriesB = seriesMap.get(repoB.repo_id) ?? [];
          row.push(pearson(seriesA, seriesB));
        }
      }
      result.push(row);
    }
    return result;
  }, [repos, seriesMap]);

  // 不夠資料時不顯示
  const hasEnoughData = repos.length >= 2 && repos.every((r) => r.data_points.length >= 7);
  if (!hasEnoughData) return null;

  return (
    <div className="correlation-matrix" data-testid="correlation-matrix">
      <h3>{t.compare.correlation.title}</h3>
      <div className="correlation-table-wrapper">
        <table className="correlation-table">
          <thead>
            <tr>
              <th />
              {repos.map((r) => (
                <th key={r.repo_id} title={r.repo_name}>
                  <span className="compare-color-dot" style={{ background: r.color }} />
                  {r.repo_name.split("/")[1] ?? r.repo_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {repos.map((repoA, i) => (
              <tr key={repoA.repo_id}>
                <th title={repoA.repo_name}>
                  <span className="compare-color-dot" style={{ background: repoA.color }} />
                  {repoA.repo_name.split("/")[1] ?? repoA.repo_name}
                </th>
                {matrix[i].map((corr, j) => (
                  <td
                    key={repos[j].repo_id}
                    className={`correlation-cell ${correlationClass(corr)}`}
                    title={isNaN(corr) ? "N/A" : corr.toFixed(3)}
                  >
                    {isNaN(corr) ? "—" : corr.toFixed(2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

// 匯出 helper 以便測試
export { pearson as _pearson, correlationClass as _correlationClass };
