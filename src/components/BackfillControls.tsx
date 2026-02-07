/**
 * Backfill 操作按鈕元件。
 */

import { TranslationKeys } from "../i18n/translations";

interface BackfillControlsProps {
  handleBackfill: () => void;
  loadStatus: () => void;
  backfilling: boolean;
  isOffline: boolean;
  loading: boolean;
  maxStars: number;
  t: TranslationKeys;
}

export function BackfillControls({
  handleBackfill,
  loadStatus,
  backfilling,
  isOffline,
  loading,
  maxStars,
  t,
}: BackfillControlsProps) {
  return (
    <>
      <button
        className="btn btn-secondary btn-sm backfill-btn"
        onClick={() => void handleBackfill()}
        disabled={backfilling || isOffline}
        title={
          isOffline
            ? t.starHistory.offlineNoBackfill
            : t.starHistory.maxStars.replace("{count}", String(maxStars))
        }
      >
        {backfilling ? t.starHistory.backfilling : t.starHistory.backfill}
      </button>

      {/* 離線時的重試按鈕 */}
      {isOffline && (
        <button
          className="btn btn-ghost btn-sm backfill-retry-btn"
          onClick={() => void loadStatus()}
          disabled={loading}
          title={t.common.retry}
        >
          {loading ? "..." : "↻"}
        </button>
      )}
    </>
  );
}
