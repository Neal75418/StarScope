/**
 * Hook for OAuth Device Flow polling logic.
 */

import { useCallback, useRef } from "react";
import { pollAuthorization, GitHubConnectionStatus } from "../api/client";
import { useI18n, interpolate } from "../i18n";
import { usePollingRefs } from "./usePollingRefs";

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
      console.error("[GitHubAuth] Authorization failed:", error);
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
        // Will be set up again in the next tick
      }
    },
    [t, currentIntervalRef, pollIntervalRef, setPollStatus]
  );

  const startPolling = useCallback(
    (code: string, interval: number, expiresIn: number) => {
      codeRef.current = code;
      currentIntervalRef.current = Math.max(interval, 10);

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
          console.error("[GitHubAuth] Poll error:", err);
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
          const newInterval = result.interval + 5;
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

      setTimeout(doPoll, 3000);
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

  return { startPolling, stopPolling, resetInterval };
}
