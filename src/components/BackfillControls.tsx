interface BackfillControlsProps {
  handleBackfill: () => void;
  loadStatus: () => void;
  backfilling: boolean;
  isOffline: boolean;
  loading: boolean;
  maxStars: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
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
            ? (t.starHistory.offlineNoBackfill ?? "Cannot backfill while offline")
            : t.starHistory.maxStars.replace("{count}", String(maxStars))
        }
      >
        {backfilling ? t.starHistory.backfilling : t.starHistory.backfill}
      </button>

      {/* Retry button when offline */}
      {isOffline && (
        <button
          className="btn btn-ghost btn-sm backfill-retry-btn"
          onClick={() => void loadStatus()}
          disabled={loading}
          title={t.common?.retry ?? "Retry"}
        >
          {loading ? "..." : "↻"}
        </button>
      )}
    </>
  );
}
