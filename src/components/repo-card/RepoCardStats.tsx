/**
 * Repo 卡片統計數據顯示元件。
 */

import { memo } from "react";
import type { RepoWithSignals } from "../../api/client";
import {
  formatNumber,
  formatDelta,
  formatVelocity,
  formatRelativeDelta,
  deltaClass,
} from "../../utils/format";
import { relativeDelta } from "../../utils/relativeDelta";
import { useI18n } from "../../i18n";

interface RepoCardStatsProps {
  repo: RepoWithSignals;
}

interface StatItemProps {
  label: string;
  value: string;
  className?: string;
}

function StatItem({ label, value, className }: StatItemProps) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${className || ""}`}>{value}</span>
    </div>
  );
}

export const RepoCardStats = memo(function RepoCardStats({ repo }: RepoCardStatsProps) {
  const { t } = useI18n();
  const relative = relativeDelta(repo.stars, repo.stars_delta_7d);

  return (
    <div className="repo-stats">
      <StatItem label={t.repo.stars} value={formatNumber(repo.stars)} />
      <StatItem
        label={t.repo.delta7d}
        value={formatDelta(repo.stars_delta_7d)}
        className={deltaClass(repo.stars_delta_7d)}
      />
      {/* 相對變化取代了原本的「趨勢」箭頭。趨勢是 velocity 過 ±0.5/day 門檻的
          分桶，而 velocity 就是七天增量除以七——換算下來「七天多 3.5 顆星以上
          就是 ↑」，94 個 repo 裡 82 個都是 ↑，篩不掉任何東西。相對變化才是
          獨立於前面兩欄的第三個資訊：這份清單從 1K 到 400K 星都有，
          +125 對 62K 星和對 1K 星不是同一件事。
          （趨勢箭頭在「趨勢」頁仍在使用，那裡才是它的位置） */}
      <StatItem
        label={t.repo.relative7d}
        value={formatRelativeDelta(relative)}
        className={deltaClass(relative)}
      />
      <StatItem
        label={t.repo.delta30d}
        value={formatDelta(repo.stars_delta_30d)}
        className={deltaClass(repo.stars_delta_30d)}
      />
      <StatItem label={t.repo.velocity} value={formatVelocity(repo.velocity)} />
    </div>
  );
});
