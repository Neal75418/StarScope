/**
 * Backfill 狀態訊息元件（離線、錯誤、成功）。
 */

import { TranslationKeys } from "../i18n";

interface BackfillMessagesProps {
  isOffline: boolean;
  error: string | null;
  successMessage: string | null;
  t: TranslationKeys;
}

export function BackfillMessages({ isOffline, error, successMessage, t }: BackfillMessagesProps) {
  return (
    <>
      {/* 離線狀態指示 */}
      {isOffline && (
        <span className="backfill-offline-badge" title={t.starHistory.offlineHint}>
          ⚠️ {t.starHistory.offlineLabel}
        </span>
      )}

      {error && <span className="backfill-error">{error}</span>}
      {successMessage && <span className="backfill-success">{successMessage}</span>}
    </>
  );
}
