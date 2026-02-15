/**
 * OAuth Device Flow 輪詢邏輯。
 */

import { useCallback, useRef, useEffect } from "react";
import { pollAuthorization, GitHubConnectionStatus } from "../api/client";
import { useI18n, interpolate } from "../i18n";
import { usePollingRefs } from "./usePollingRefs";
import {
  DEVICE_FLOW_MIN_POLL_INTERVAL_SEC,
  DEVICE_FLOW_SLOWDOWN_EXTRA_SEC,
  DEVICE_FLOW_INITIAL_DELAY_MS,
} from "../constants/api";
import { logger } from "../utils/logger";

interface UseDeviceFlowPollingOptions {
  onSuccess: (status: GitHubConnectionStatus) => void;
  onError: (error: string) => void;
  onExpired: () => void;
  setPollStatus: (status: string) => void;
}

interface UseDeviceFlowPollingResult {
  startPolling: (code: string, interval: number, expiresIn: number) => void;
  stopPolling: () => void;
  resetInterval: () => void;
}

export function useDeviceFlowPolling({
  onSuccess,
  onError,
  onExpired,
  setPollStatus,
}: UseDeviceFlowPollingOptions): UseDeviceFlowPollingResult {
  const { t } = useI18n();
  const { pollIntervalRef, pollTimeoutRef, currentIntervalRef, stopPolling, resetInterval } =
    usePollingRefs();
  const codeRef = useRef<string>("");
  const initialDelayRef = useRef<number | null>(null);

  const handleSuccess = useCallback(
    (username?: string) => {
      setPollStatus(t.githubConnection.status.connected);
      stopPolling();
      onSuccess({ connected: true, username });
    },
    [t, stopPolling, onSuccess, setPollStatus]
  );

  const handleError = useCallback(
    (error?: string) => {
      logger.error("[GitHub 驗證] 授權失敗:", error);
      setPollStatus("");
      stopPolling();
      onError(error || t.githubConnection.errors.failed);
    },
    [t, stopPolling, onError, setPollStatus]
  );

  const restartWithNewInterval = useCallback(
    (newInterval: number) => {
      currentIntervalRef.current = newInterval;
      setPollStatus(interpolate(t.githubConnection.status.rateLimited, { seconds: newInterval }));

      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        // 將在下一個 tick 重新設定
      }
    },
    [t, currentIntervalRef, pollIntervalRef, setPollStatus]
  );

  const startPolling = useCallback(
    (code: string, interval: number, expiresIn: number) => {
      codeRef.current = code;
      currentIntervalRef.current = Math.max(interval, DEVICE_FLOW_MIN_POLL_INTERVAL_SEC);

      pollTimeoutRef.current = window.setTimeout(() => {
        stopPolling();
        onExpired();
      }, expiresIn * 1000);

      const doPoll = async () => {
        try {
          setPollStatus(
            interpolate(t.githubConnection.status.checking, {
              seconds: currentIntervalRef.current,
            })
          );
          const result = await pollAuthorization(codeRef.current);
          processResult(result, doPoll);
        } catch (err) {
          logger.error("[GitHub 驗證] 輪詢錯誤:", err);
          setPollStatus(t.githubConnection.status.networkError);
        }
      };

      const processResult = (
        result: {
          status: string;
          username?: string;
          error?: string;
          slow_down?: boolean;
          interval?: number;
        },
        pollFn: () => Promise<void>
      ) => {
        if (result.status === "success") {
          handleSuccess(result.username);
        } else if (result.status === "expired" || result.status === "error") {
          handleError(result.error);
        } else if (result.status === "pending" && result.slow_down && result.interval) {
          const newInterval = result.interval + DEVICE_FLOW_SLOWDOWN_EXTRA_SEC;
          restartWithNewInterval(newInterval);
          pollIntervalRef.current = window.setInterval(pollFn, newInterval * 1000);
        } else {
          setPollStatus(
            interpolate(t.githubConnection.status.waiting, {
              seconds: currentIntervalRef.current,
            })
          );
        }
      };

      initialDelayRef.current = window.setTimeout(doPoll, DEVICE_FLOW_INITIAL_DELAY_MS);
      pollIntervalRef.current = window.setInterval(doPoll, currentIntervalRef.current * 1000);
    },
    [
      t,
      pollIntervalRef,
      pollTimeoutRef,
      currentIntervalRef,
      stopPolling,
      onExpired,
      setPollStatus,
      handleSuccess,
      handleError,
      restartWithNewInterval,
    ]
  );

  // 元件卸載時清理 initialDelay timeout
  useEffect(() => {
    return () => {
      if (initialDelayRef.current !== null) {
        clearTimeout(initialDelayRef.current);
      }
    };
  }, []);

  return { startPolling, stopPolling, resetInterval };
}
