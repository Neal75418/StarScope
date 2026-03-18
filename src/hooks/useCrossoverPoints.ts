/**
 * Crossover Detection — 偵測兩個 repo 星數（或 forks）交叉的時間點。
 * 限制 repos ≤ 3 時才啟用（C(3,2)=3 pairs），避免 4-5 repo 時視覺雜訊。
 */

import { useMemo } from "react";

export interface CrossoverPoint {
  date: string;
  repoA: string;
  repoB: string;
  /** repoA 在交叉後領先 */
  value: number;
}

interface UseCrossoverPointsOptions {
  chartData: { date: string; [key: string]: string | number }[];
  repos: { repo_id: number; repo_name: string }[];
  metric: string;
}

const MAX_REPOS = 3;

export function useCrossoverPoints({
  chartData,
  repos,
  metric,
}: UseCrossoverPointsOptions): CrossoverPoint[] {
  return useMemo(() => {
    if (repos.length < 2 || repos.length > MAX_REPOS || chartData.length < 2) {
      return [];
    }

    const result: CrossoverPoint[] = [];

    // 檢查每對 repo
    for (let a = 0; a < repos.length; a++) {
      for (let b = a + 1; b < repos.length; b++) {
        const keyA = `${metric}_${repos[a].repo_id}`;
        const keyB = `${metric}_${repos[b].repo_id}`;

        for (let i = 1; i < chartData.length; i++) {
          const prevA = chartData[i - 1][keyA] as number | undefined;
          const prevB = chartData[i - 1][keyB] as number | undefined;
          const currA = chartData[i][keyA] as number | undefined;
          const currB = chartData[i][keyB] as number | undefined;

          if (prevA == null || prevB == null || currA == null || currB == null) {
            continue;
          }

          const prevDiff = prevA - prevB;
          const currDiff = currA - currB;

          // 變號 = 交叉
          if (prevDiff !== 0 && currDiff !== 0 && Math.sign(prevDiff) !== Math.sign(currDiff)) {
            result.push({
              date: chartData[i].date,
              repoA: currDiff > 0 ? repos[a].repo_name : repos[b].repo_name,
              repoB: currDiff > 0 ? repos[b].repo_name : repos[a].repo_name,
              value: currDiff > 0 ? currA : currB,
            });
          }
        }
      }
    }

    return result;
  }, [chartData, repos, metric]);
}
