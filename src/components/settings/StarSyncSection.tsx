/**
 * Star 同步設定區塊。
 *
 * 顯示上「什麼都沒發生」必須說得出原因：同步在沒有 token、取得失敗、回傳 0 筆、
 * 或已有一輪在跑時，都會刻意不執行任何移除。這些情況只顯示「完成」會讓使用者
 * 以為 GitHub 上真的沒有變動，而實際上是這一輪根本沒比對。
 */
import { useI18n } from "../../i18n";
import { useStarSync } from "../../hooks/useStarSync";
import { formatRelativeTime } from "../../utils/format";
import { getErrorMessage } from "../../utils/error";

export function StarSyncSection() {
  const { t } = useI18n();
  const copy = t.settings.starSync;
  const { status, sync, isSyncing, lastResult, error } = useStarSync();

  const skippedMessage =
    lastResult?.skipped_reason != null
      ? (copy.skipped as Record<string, string>)[lastResult.skipped_reason]
      : null;

  return (
    <div className="settings-section" data-testid="star-sync-section">
      <div className="settings-section-header">
        <div>
          <h2>{copy.title}</h2>
          <p className="settings-description">{copy.description}</p>
        </div>
        <div className="settings-section-actions">
          <button
            className="btn btn-primary"
            data-testid="star-sync-btn"
            disabled={isSyncing}
            onClick={() => void sync().catch(() => undefined)}
          >
            {isSyncing ? copy.syncing : copy.sync}
          </button>
        </div>
      </div>

      <p className="settings-hint">
        {status?.last_sync_at
          ? `${copy.lastSynced} ${formatRelativeTime(status.last_sync_at)}`
          : copy.never}
      </p>

      {error != null && (
        <p className="settings-error" role="alert">
          {getErrorMessage(error, copy.error)}
        </p>
      )}

      {/* 略過的原因優先於計數：計數全是 0 時，「為什麼」才是使用者要看的 */}
      {skippedMessage ? (
        <p className="settings-hint" data-testid="star-sync-skipped">
          {skippedMessage}
        </p>
      ) : (
        lastResult != null && (
          <p className="settings-hint" data-testid="star-sync-result">
            {copy.resultAdded} {lastResult.added} · {copy.resultRestored} {lastResult.restored} ·{" "}
            {copy.resultRenamed} {lastResult.renamed} · {copy.resultArchived} {lastResult.archived}
          </p>
        )
      )}

      {lastResult != null && lastResult.pending_local_only.length > 0 && (
        <div className="settings-subsection" data-testid="star-sync-pending">
          <h3>{copy.pendingTitle}</h3>
          <p className="settings-description">{copy.pendingHint}</p>
          <ul className="settings-plain-list">
            {lastResult.pending_local_only.map((fullName) => (
              <li key={fullName}>{fullName}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
