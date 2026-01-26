/**
 * Star history backfill component.
 * Shows backfill status and button for repos with < 5000 stars.
 * Supports offline UX with cached data display.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { BackfillStatus, getBackfillStatus, backfillStarHistory, ApiError } from "../api/client";
import { useI18n } from "../i18n";

interface StarHistoryBackfillProps {
  repoId: number;
  currentStars: number | null;
  onBackfillComplete?: () => void;
}

const MAX_STARS_FOR_BACKFILL = 5000;

// Check if error is a network error
function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && err.message === "Failed to fetch") {
    return true;
  }
  if (err instanceof ApiError && (err.status === 0 || err.status >= 500)) {
    return true;
  }
  return false;
}

// Format relative time for last updated
function formatRelativeTime(date: Date | null, justNowText: string): string {
  if (!date) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return justNowText;
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function StarHistoryBackfill({ repoId, currentStars, onBackfillComplete }: StarHistoryBackfillProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<BackfillStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Keep last successful status when offline
  const lastStatusRef = useRef<BackfillStatus | null>(null);

  // Check if should render based on star count
  const exceedsStarLimit = currentStars !== null && currentStars > MAX_STARS_FOR_BACKFILL;

  const loadStatus = useCallback(async () => {
    if (exceedsStarLimit) return; // Skip loading if not eligible

    try {
      setLoading(true);
      setError(null);
      setIsOffline(false);
      const result = await getBackfillStatus(repoId);
      setStatus(result);
      lastStatusRef.current = result;
      setLastUpdated(new Date());
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setStatus(null);
        lastStatusRef.current = null;
      } else if (isNetworkError(err)) {
        // Network error - show offline state but keep last data
        console.warn("Network error loading backfill status:", err);
        setIsOffline(true);
        if (lastStatusRef.current) {
          setStatus(lastStatusRef.current);
        }
        setError(t.starHistory.offline ?? "Offline - showing cached data");
      } else {
        console.error("Failed to load backfill status:", err);
        setError(t.starHistory.backfillFailed);
      }
    } finally {
      setLoading(false);
    }
  }, [repoId, t, exceedsStarLimit]);

  const handleBackfill = useCallback(async () => {
    // Don't allow backfill when offline
    if (isOffline) {
      setError(t.starHistory.offlineNoBackfill ?? "Cannot backfill while offline");
      return;
    }

    try {
      setBackfilling(true);
      setError(null);
      setSuccessMessage(null);
      const result = await backfillStarHistory(repoId);
      if (result.success) {
        setSuccessMessage(t.starHistory.backfillComplete.replace("{count}", String(result.snapshots_created)));
        // Reload status after backfill
        await loadStatus();
        onBackfillComplete?.();
      } else {
        setError(result.message);
      }
    } catch (err) {
      console.error("Backfill failed:", err);
      if (isNetworkError(err)) {
        setIsOffline(true);
        setError(t.starHistory.offlineNoBackfill ?? "Cannot backfill while offline");
      } else if (err instanceof ApiError) {
        if (err.status === 429) {
          setError(t.starHistory.rateLimited ?? "Rate limit exceeded. Please try again later.");
        } else {
          setError(err.detail || t.starHistory.backfillFailed);
        }
      } else {
        setError(t.starHistory.backfillFailed);
      }
    } finally {
      setBackfilling(false);
    }
  }, [repoId, t, loadStatus, onBackfillComplete, isOffline]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

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
      {/* Offline indicator */}
      {isOffline && (
        <span className="backfill-offline-badge" title={t.starHistory.offlineHint ?? "Data may be outdated"}>
          ⚠️ {t.starHistory.offlineLabel ?? "Offline"}
        </span>
      )}

      {error && <span className="backfill-error">{error}</span>}
      {successMessage && <span className="backfill-success">{successMessage}</span>}

      {status && (
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
      )}

      <button
        className="btn btn-secondary btn-sm backfill-btn"
        onClick={handleBackfill}
        disabled={backfilling || isOffline}
        title={isOffline
          ? (t.starHistory.offlineNoBackfill ?? "Cannot backfill while offline")
          : t.starHistory.maxStars.replace("{count}", String(MAX_STARS_FOR_BACKFILL))}
      >
        {backfilling ? t.starHistory.backfilling : t.starHistory.backfill}
      </button>

      {/* Retry button when offline */}
      {isOffline && (
        <button
          className="btn btn-ghost btn-sm backfill-retry-btn"
          onClick={loadStatus}
          disabled={loading}
          title={t.common?.retry ?? "Retry"}
        >
          {loading ? "..." : "↻"}
        </button>
      )}
    </div>
  );
}
