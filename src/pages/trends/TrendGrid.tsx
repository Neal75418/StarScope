/**
 * 趨勢 Grid 佈局，以卡片形式顯示趨勢 repo。
 */

import type { useI18n } from "../../i18n";
import type { TrendingRepo } from "../../api/client";
import type { EarlySignal } from "../../api/types";
import { TrendCard } from "./TrendCard";

interface TrendGridProps {
  trends: TrendingRepo[];
  t: ReturnType<typeof useI18n>["t"];
  signalsByRepoId?: Record<number, EarlySignal[]>;
}

export function TrendGrid({ trends, t, signalsByRepoId }: TrendGridProps) {
  return (
    <div className="trend-grid" data-testid="trends-grid">
      {trends.map((repo) => (
        <TrendCard key={repo.id} repo={repo} t={t} signals={signalsByRepoId?.[repo.id]} />
      ))}
    </div>
  );
}
