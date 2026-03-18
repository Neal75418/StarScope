/**
 * Watchlist 摘要面板：Top Velocity、Signal 數、Stale 數。
 */

import { useMemo, memo } from "react";
import type { RepoWithSignals, EarlySignal } from "../../api/client";
import { useCollapsible } from "../../hooks/useCollapsible";
import { isHotRepo, isStaleRepo, hasActiveSignals } from "../../utils/repoStatus";
import { STORAGE_KEYS } from "../../constants/storage";
import { useI18n } from "../../i18n";

interface SummaryPanelProps {
  repos: RepoWithSignals[];
  batchSignals: Record<number, EarlySignal[] | undefined>;
}

export const SummaryPanel = memo(function SummaryPanel({ repos, batchSignals }: SummaryPanelProps) {
  const { t } = useI18n();
  const { collapsed, toggle } = useCollapsible(STORAGE_KEYS.WATCHLIST_SUMMARY_COLLAPSED);

  const stats = useMemo(() => {
    const topVelocity = [...repos]
      .filter((r) => r.velocity != null)
      .sort((a, b) => (b.velocity ?? 0) - (a.velocity ?? 0))
      .slice(0, 3);

    let signalRepoCount = 0;
    let staleCount = 0;

    for (const repo of repos) {
      const signals = batchSignals[repo.id];
      if (signals && hasActiveSignals(signals)) signalRepoCount++;
      if (isStaleRepo(repo)) staleCount++;
    }

    const hotCount = repos.filter(isHotRepo).length;

    return { topVelocity, signalRepoCount, staleCount, hotCount };
  }, [repos, batchSignals]);

  return (
    <div className="summary-panel" data-testid="summary-panel">
      <button
        className="summary-panel-toggle"
        onClick={toggle}
        aria-expanded={!collapsed}
        data-testid="summary-toggle"
      >
        {t.watchlist.summary.title}
        <span className="summary-panel-arrow">{collapsed ? "▸" : "▾"}</span>
      </button>

      {!collapsed && (
        <div className="summary-panel-content">
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
              <span className="summary-stat-number">{stats.signalRepoCount}</span>
            </div>

            <div className="summary-stat" data-testid="summary-stale-count">
              <span className="summary-stat-label">{t.watchlist.summary.staleRepos}</span>
              <span className="summary-stat-number">{stats.staleCount}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
