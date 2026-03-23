/**
 * GitHub 已連線狀態元件。
 */

import { useState, useEffect, useCallback } from "react";
import { GitHubConnectionStatus } from "../../api/client";
import { useI18n, interpolate } from "../../i18n";

interface ConnectionConnectedProps {
  status: GitHubConnectionStatus;
  onDisconnect: () => void;
  onRefresh: () => Promise<void>;
}

/**
 * 將秒數格式化為易讀的倒數字串，使用本地化時間單位。
 */
function formatCountdown(seconds: number, units: { h: string; m: string; s: string }): string {
  if (seconds <= 0) return `0${units.s}`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}${units.h} ${minutes}${units.m}`;
  }
  if (minutes > 0) {
    return `${minutes}${units.m} ${secs}${units.s}`;
  }
  return `${secs}${units.s}`;
}

export function ConnectionConnected({ status, onDisconnect, onRefresh }: ConnectionConnectedProps) {
  const { t } = useI18n();
  const [countdown, setCountdown] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 每秒計算並更新倒數
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
        setCountdown(formatCountdown(secondsRemaining, t.common.timeUnits));
      }
    };

    // 初次更新
    updateCountdown();

    // 每秒更新
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [status.rate_limit_reset, t.common.timeUnits]);

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
        <span className="icon-connected">✓</span>
      </div>
      <div className="status-content">
        <div className="status-text">
          {t.githubConnection.connectedAs} <strong>@{status.username}</strong>
        </div>
        {status.rate_limit_remaining !== undefined && (
          <div className="status-rate-limit">
            <span
              className={`rate-limit-numbers${
                (status.rate_limit_remaining ?? 0) / (status.rate_limit_total || 1) < 0.2
                  ? " rate-limit-warning"
                  : ""
              }`}
            >
              {interpolate(t.githubConnection.apiQuota, {
                remaining: status.rate_limit_remaining?.toLocaleString() ?? "0",
                total: status.rate_limit_total?.toLocaleString() ?? "0",
                suffix: t.githubConnection.remaining,
              })}
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
          aria-label={t.githubConnection.refresh}
        >
          {isRefreshing ? "⟳" : "↻"}
        </button>
        <button onClick={onDisconnect} className="btn btn-danger">
          {t.githubConnection.disconnect}
        </button>
      </div>
    </div>
  );
}
