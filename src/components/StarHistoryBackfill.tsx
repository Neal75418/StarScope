/**
 * Star 歷史回填元件，管理 backfill 狀態與操作。
 */

import { useI18n } from "../i18n";
import { formatRelativeTime, MAX_STARS_FOR_BACKFILL } from "../utils/backfillHelpers";
import { useBackfillStatus } from "../hooks/useBackfillStatus";
import { useBackfillAction } from "../hooks/useBackfillAction";
import { BackfillStatusBadge } from "./BackfillStatusBadge";
import { BackfillControls } from "./BackfillControls";
import { BackfillMessages } from "./BackfillMessages";
import { LoadError } from "./LoadError";

interface StarHistoryBackfillProps {
  repoId: number;
  currentStars: number | null;
  onBackfillComplete?: () => void;
}

export function StarHistoryBackfill({
  repoId,
  currentStars,
  onBackfillComplete,
}: StarHistoryBackfillProps) {
  const { t, language } = useI18n();

  // 依 star 數判斷是否需要顯示
  const exceedsStarLimit = currentStars !== null && currentStars > MAX_STARS_FOR_BACKFILL;

  const { status, loading, error, isOffline, lastUpdated, loadStatus, statusLoad } =
    useBackfillStatus(repoId, exceedsStarLimit);

  const { backfilling, errorMessage, successMessage, warningMessage, handleBackfill } =
    useBackfillAction({
      repoId,
      isOffline,
      onSuccess: loadStatus,
      onComplete: onBackfillComplete,
    });

  // star 數超過上限時不顯示
  if (exceedsStarLimit) {
    return null;
  }

  // 讀不到之後按重試：還沒有資料時 React Query 把查詢改回 pending、loading 又是 true，不能整塊換成「檢查中」，
  // 重試鈕（與焦點）要留在原處顯示重試中
  if (loading && !statusLoad.failed) {
    return (
      <div className="star-history-backfill">
        <span className="backfill-status checking">{t.starHistory.checking}</span>
      </div>
    );
  }

  // 狀態顯示不符合資格時不渲染
  if (status && !status.can_backfill) {
    return null;
  }

  const lastUpdatedText = formatRelativeTime(
    lastUpdated,
    t.relativeTime.justNow,
    t.relativeTime.suffix
  );

  return (
    <div className={`star-history-backfill ${isOffline ? "offline" : ""}`}>
      <BackfillMessages
        isOffline={isOffline}
        // 回填失敗的原因優先；沒有時才是讀狀態那邊的說明（離線）
        error={errorMessage ?? error}
        successMessage={successMessage}
        warningMessage={warningMessage}
        t={t}
      />
      {/* 讀不到狀態（引擎連得到，只是伺服器錯誤或逾時）：說讀不到並給重試；回填鈕照常可以按 */}
      {statusLoad.failed && !isOffline && (
        <LoadError
          message={t.starHistory.statusLoadFailed}
          onRetry={statusLoad.retry}
          isRetrying={statusLoad.inProgress}
        />
      )}

      {status && (
        <BackfillStatusBadge
          status={status}
          lastUpdated={lastUpdated}
          lastUpdatedText={lastUpdatedText}
          t={t}
          language={language}
        />
      )}

      <BackfillControls
        handleBackfill={handleBackfill}
        loadStatus={loadStatus}
        backfilling={backfilling}
        isOffline={isOffline}
        loading={loading}
        maxStars={MAX_STARS_FOR_BACKFILL}
        t={t}
      />
    </div>
  );
}
