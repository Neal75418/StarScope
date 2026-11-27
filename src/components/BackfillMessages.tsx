/**
 * Backfill 狀態訊息元件（離線、錯誤、不確定、成功）。
 */

import type { TranslationKeys } from "../i18n";

interface BackfillMessagesProps {
  isOffline: boolean;
  error: string | null;
  successMessage: string | null;
  /** 不確定的結果（例如等不到回應）：警告，不是錯誤。必填：漏傳的話逾時時畫面什麼都不顯示，型別檢查要擋得住 */
  warningMessage: string | null;
  t: TranslationKeys;
}

export function BackfillMessages({
  isOffline,
  error,
  successMessage,
  warningMessage,
  t,
}: BackfillMessagesProps) {
  return (
    <>
      {/* 離線狀態指示 */}
      {isOffline && (
        <span className="backfill-offline-badge" title={t.starHistory.offlineHint}>
          ⚠️ {t.starHistory.offlineLabel}
        </span>
      )}

      {error && (
        <span className="backfill-error" role="alert">
          {error}
        </span>
      )}
      {warningMessage && (
        <span className="backfill-warning" role="status">
          {warningMessage}
        </span>
      )}
      {successMessage && (
        <span className="backfill-success" role="status">
          {successMessage}
        </span>
      )}
    </>
  );
}
