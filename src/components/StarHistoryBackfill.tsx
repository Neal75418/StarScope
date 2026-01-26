import { useI18n } from "../i18n";
import { formatRelativeTime } from "../utils/backfillHelpers";
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

const MAX_STARS_FOR_BACKFILL = 5000;

export function StarHistoryBackfill({
  repoId,
  currentStars,
  onBackfillComplete,
}: StarHistoryBackfillProps) {
  const { t } = useI18n();

  // Check if should render based on star count
  const exceedsStarLimit = currentStars !== null && currentStars > MAX_STARS_FOR_BACKFILL;

  const { status, loading, error, isOffline, lastUpdated, loadStatus, setError } =
    useBackfillStatus(repoId, exceedsStarLimit);

  const { backfilling, successMessage, handleBackfill } = useBackfillAction({
    repoId,
    isOffline,
    onSuccess: loadStatus,
    onComplete: onBackfillComplete,
    setError,
  });

  // Don't show component if stars exceed limit
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

  // Don't render if not eligible based on status
  if (status && !status.can_backfill) {
    return null;
  }

  const lastUpdatedText = formatRelativeTime(lastUpdated, t.relativeTime?.justNow ?? "Just now");

  return (
    <div className={`star-history-backfill ${isOffline ? "offline" : ""}`}>
      <BackfillMessages isOffline={isOffline} error={error} successMessage={successMessage} t={t} />

      {status && (
        <BackfillStatusBadge
          status={status}
          lastUpdated={lastUpdated}
          lastUpdatedText={lastUpdatedText}
          t={t}
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
