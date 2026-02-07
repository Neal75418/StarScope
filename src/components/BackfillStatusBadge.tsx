/**
 * Backfill 狀態徽章，顯示是否已有回填資料。
 */

import { TranslationKeys } from "../i18n/translations";

interface BackfillStatusBadgeProps {
  status: {
    has_backfilled_data: boolean;
    backfilled_days?: number;
    can_backfill: boolean;
  };
  lastUpdated: Date | null;
  lastUpdatedText: string;
  t: TranslationKeys;
}

export function BackfillStatusBadge({
  status,
  lastUpdated,
  lastUpdatedText,
  t,
}: BackfillStatusBadgeProps) {
  return (
    <div className="backfill-info">
      {status.has_backfilled_data ? (
        <span className="backfill-status has-data">
          {t.starHistory.alreadyBackfilled.replace("{days}", String(status.backfilled_days))}
        </span>
      ) : (
        <span className="backfill-status eligible">{t.starHistory.eligible}</span>
      )}
      {lastUpdated && (
        <span className="backfill-last-updated" title={lastUpdated.toLocaleString()}>
          {lastUpdatedText}
        </span>
      )}
    </div>
  );
}
