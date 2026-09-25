/**
 * Watchlist 摘要面板：Top Velocity、Signal 數、Stale 數。
 *
 * 「有訊號」由呼叫端從後端的訊號摘要帶進來，不從卡片的批次資料數：批次資料只載入
 * 可見範圍附近的卡，訊號落在畫面外的 repo 會被算成沒有。
 */

import { useMemo, memo } from "react";
import type { RepoWithSignals } from "../../api/client";
import { useCollapsible } from "../../hooks/useCollapsible";
import { isHotRepo, isStaleRepo } from "../../utils/repoStatus";
import { STORAGE_KEYS } from "../../constants/storage";
import { useI18n } from "../../i18n";

interface SummaryPanelProps {
  repos: RepoWithSignals[];
  /** 有活躍訊號的 repo 數；null 表示還不知道（載入中或失敗），顯示成「—」而不是 0 */
  signalRepoCount: number | null;
}

export const SummaryPanel = memo(function SummaryPanel({
  repos,
  signalRepoCount,
}: SummaryPanelProps) {
  const { t } = useI18n();
  const { collapsed, toggle } = useCollapsible(STORAGE_KEYS.WATCHLIST_SUMMARY_COLLAPSED);

  const stats = useMemo(() => {
    const topVelocity = [...repos]
      .filter((r) => r.velocity != null)
      .sort((a, b) => (b.velocity ?? 0) - (a.velocity ?? 0))
      .slice(0, 3);

    const staleCount = repos.filter(isStaleRepo).length;
    const hotCount = repos.filter(isHotRepo).length;

    return { topVelocity, staleCount, hotCount };
  }, [repos]);

  return (
    <div className="summary-panel" data-testid="summary-panel">
      <button
        className="summary-panel-toggle"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls="summary-panel-content"
        data-testid="summary-toggle"
      >
        {t.watchlist.summary.title}
        <span className="summary-panel-arrow">{collapsed ? "▸" : "▾"}</span>
      </button>

      <div
        className="summary-panel-content"
        id="summary-panel-content"
        hidden={collapsed || undefined}
      >
        <div className="summary-stat-group">
          <div className="summary-stat" data-testid="summary-top-velocity">
            <span className="summary-stat-label">{t.watchlist.summary.topVelocity}</span>
            <div className="summary-stat-value">
              {stats.topVelocity.length > 0 ? (
                stats.topVelocity.map((r) => (
                  <span key={r.id} className="summary-repo-chip" title={r.full_name}>
                    {r.name}
                    <span className="summary-velocity">{r.velocity?.toFixed(1)}</span>
                  </span>
                ))
              ) : (
                <span className="summary-empty">—</span>
              )}
            </div>
          </div>

          <div className="summary-stat" data-testid="summary-hot-count">
            <span className="summary-stat-label">{t.watchlist.summary.hotRepos}</span>
            <span className="summary-stat-number">{stats.hotCount}</span>
          </div>

          <div className="summary-stat" data-testid="summary-signal-count">
            <span className="summary-stat-label">{t.watchlist.summary.signalRepos}</span>
            <span className="summary-stat-number">{signalRepoCount ?? "—"}</span>
          </div>

          <div className="summary-stat" data-testid="summary-stale-count">
            <span className="summary-stat-label">{t.watchlist.summary.staleRepos}</span>
            <span className="summary-stat-number">{stats.staleCount}</span>
          </div>
        </div>
      </div>
    </div>
  );
});
