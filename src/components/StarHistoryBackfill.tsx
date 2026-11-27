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

  const { status, loading, error, isOffline, lastUpdated, loadStatus, setError } =
    useBackfillStatus(repoId, exceedsStarLimit);

  const { backfilling, successMessage, warningMessage, handleBackfill } = useBackfillAction({
    repoId,
    isOffline,
    onSuccess: loadStatus,
    onComplete: onBackfillComplete,
    setError,
  });

  // star 數超過上限時不顯示
  if (exceedsStarLimit) {
    return null;
  }

  if (loading) {
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
        error={error}
        successMessage={successMessage}
        warningMessage={warningMessage}
        t={t}
      />

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
