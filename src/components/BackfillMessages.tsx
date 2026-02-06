/**
 * Backfill 狀態訊息元件（離線、錯誤、成功）。
 */

interface BackfillMessagesProps {
  isOffline: boolean;
  error: string | null;
  successMessage: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}

export function BackfillMessages({ isOffline, error, successMessage, t }: BackfillMessagesProps) {
  return (
    <>
      {/* 離線狀態指示 */}
      {isOffline && (
        <span
          className="backfill-offline-badge"
          title={t.starHistory.offlineHint ?? "Data may be outdated"}
        >
          ⚠️ {t.starHistory.offlineLabel ?? "Offline"}
        </span>
      )}

      {error && <span className="backfill-error">{error}</span>}
      {successMessage && <span className="backfill-success">{successMessage}</span>}
    </>
  );
}
