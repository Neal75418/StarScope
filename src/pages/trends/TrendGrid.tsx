/**
 * 趨勢 Grid 佈局，以卡片形式顯示趨勢 repo。
 */

import type { useI18n } from "../../i18n";
import type { TrendingRepo } from "../../api/client";
import type { EarlySignal } from "../../api/types";
import { TrendCard } from "./TrendCard";

interface TrendGridProps {
  trends: TrendingRepo[];
  allWatchlistNames: Set<string>;
  addingRepoId: number | null;
  onAddToWatchlist: (repo: TrendingRepo) => void;
  t: ReturnType<typeof useI18n>["t"];
  isSelectionMode?: boolean;
  selectedIds?: Set<number>;
  onToggleSelection?: (repoId: number) => void;
  signalsByRepoId?: Record<number, EarlySignal[]>;
}

export function TrendGrid({
  trends,
  allWatchlistNames,
  addingRepoId,
  onAddToWatchlist,
  t,
  isSelectionMode,
  selectedIds,
  onToggleSelection,
  signalsByRepoId,
}: TrendGridProps) {
  return (
    <div className="trend-grid" data-testid="trends-grid">
      {trends.map((repo) => (
        <TrendCard
          key={repo.id}
          repo={repo}
          isInWatchlist={allWatchlistNames.has(repo.full_name.toLowerCase())}
          isAdding={addingRepoId === repo.id}
          onAddToWatchlist={onAddToWatchlist}
          t={t}
          isSelectionMode={isSelectionMode}
          isSelected={selectedIds?.has(repo.id)}
          onToggleSelection={onToggleSelection}
          signals={signalsByRepoId?.[repo.id]}
        />
      ))}
    </div>
  );
}
