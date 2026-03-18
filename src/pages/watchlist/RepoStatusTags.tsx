/**
 * Repo 狀態標籤：Hot / Stale / Signal badges。
 */

import { memo } from "react";
import type { RepoWithSignals, EarlySignal } from "../../api/client";
import { isHotRepo, isStaleRepo, hasActiveSignals } from "../../utils/repoStatus";
import { useI18n } from "../../i18n";

interface RepoStatusTagsProps {
  repo: RepoWithSignals;
  signals?: EarlySignal[];
}

export const RepoStatusTags = memo(function RepoStatusTags({ repo, signals }: RepoStatusTagsProps) {
  const { t } = useI18n();
  const hot = isHotRepo(repo);
  const stale = isStaleRepo(repo);
  const hasSignals = signals ? hasActiveSignals(signals) : false;

  if (!hot && !stale && !hasSignals) return null;

  return (
    <span className="status-tags" data-testid="status-tags">
      {hot && <span className="status-tag status-hot">{t.watchlist.statusTags.hot}</span>}
      {stale && <span className="status-tag status-stale">{t.watchlist.statusTags.stale}</span>}
      {hasSignals && (
        <span className="status-tag status-signal">{t.watchlist.statusTags.signal}</span>
      )}
    </span>
  );
});
