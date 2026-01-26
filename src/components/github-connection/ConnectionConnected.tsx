/**
 * Connected state for GitHub connection.
 */

import { useState, useEffect, useCallback } from "react";
import { GitHubConnectionStatus } from "../../api/client";
import { useI18n } from "../../i18n";

interface ConnectionConnectedProps {
  status: GitHubConnectionStatus;
  onDisconnect: () => void;
  onRefresh: () => Promise<void>;
}

/**
 * Formats seconds into a human-readable countdown string.
 * @param seconds - Number of seconds remaining
 * @returns Formatted string like "45m 30s" or "1h 23m"
 */
function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "0s";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

export function ConnectionConnected({ status, onDisconnect, onRefresh }: ConnectionConnectedProps) {
  const { t } = useI18n();
  const [countdown, setCountdown] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Calculate and update countdown every second
  useEffect(() => {
    const resetTime = status.rate_limit_reset;
    if (!resetTime) {
      setCountdown("");
      return;
    }

    const updateCountdown = () => {
      const now = Math.floor(Date.now() / 1000);
      const secondsRemaining = resetTime - now;

      if (secondsRemaining <= 0) {
        setCountdown("");
      } else {
        setCountdown(formatCountdown(secondsRemaining));
      }
    };

    // Initial update
    updateCountdown();

    // Update every second
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [status.rate_limit_reset]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh]);

  return (
    <div className="github-status connected">
      <div className="status-icon">
        <span className="icon-connected">OK</span>
      </div>
      <div className="status-content">
        <div className="status-text">
          {t.githubConnection.connectedAs} <strong>@{status.username}</strong>
        </div>
        {status.rate_limit_remaining !== undefined && (
          <div className="status-rate-limit">
            <span className="rate-limit-numbers">
              API: {status.rate_limit_remaining?.toLocaleString()} /{" "}
              {status.rate_limit_total?.toLocaleString()} {t.githubConnection.remaining}
            </span>
            {countdown && (
              <span className="rate-limit-reset">
                ({t.githubConnection.resetsIn} {countdown})
              </span>
            )}
          </div>
        )}
      </div>
      <div className="status-actions">
        <button
          onClick={handleRefresh}
          className="btn btn-secondary"
          disabled={isRefreshing}
          title={t.githubConnection.refresh}
        >
          {isRefreshing ? "..." : "↻"}
        </button>
        <button onClick={onDisconnect} className="btn btn-danger">
          {t.githubConnection.disconnect}
        </button>
      </div>
    </div>
  );
}
