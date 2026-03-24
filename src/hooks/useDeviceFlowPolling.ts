/**
 * OAuth Device Flow 輪詢邏輯。
 * 使用 recursive setTimeout 而非 setInterval，確保前一次請求完成後才排程下一次。
 */

import { useCallback, useRef, useEffect } from "react";
import type { GitHubConnectionStatus } from "../api/client";
import { pollAuthorization } from "../api/client";
import { useI18n, interpolate } from "../i18n";
import {
  DEVICE_FLOW_MIN_POLL_INTERVAL_SEC,
  DEVICE_FLOW_SLOWDOWN_EXTRA_SEC,
  DEVICE_FLOW_INITIAL_DELAY_MS,
} from "../constants/api";
import { logger } from "../utils/logger";
import { useOnlineStatus } from "./useOnlineStatus";

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
  const isOnline = useOnlineStatus();
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;

  const nextPollRef = useRef<number | null>(null);
  const pollTimeoutRef = useRef<number | null>(null);
  const currentIntervalRef = useRef<number>(10);

  const codeRef = useRef<string>("");
  const sessionIdRef = useRef(0);
  const initialDelayRef = useRef<number | null>(null);

  // 清理所有 timers，並作廢飛行中的請求
  const stopPolling = useCallback(() => {
    sessionIdRef.current++;
    if (initialDelayRef.current !== null) {
      clearTimeout(initialDelayRef.current);
      initialDelayRef.current = null;
    }
    if (nextPollRef.current !== null) {
      clearTimeout(nextPollRef.current);
      nextPollRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const resetInterval = useCallback(() => {
    currentIntervalRef.current = 10;
  }, []);

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

  const startPolling = useCallback(
    (code: string, interval: number, expiresIn: number) => {
      stopPolling(); // 清除前一次 polling session
      const sessionId = sessionIdRef.current;
      codeRef.current = code;
      currentIntervalRef.current = Math.max(interval, DEVICE_FLOW_MIN_POLL_INTERVAL_SEC);

      pollTimeoutRef.current = window.setTimeout(() => {
        stopPolling();
        onExpired();
      }, expiresIn * 1000);

      const scheduleNext = () => {
        nextPollRef.current = window.setTimeout(doPoll, currentIntervalRef.current * 1000);
      };

      const doPoll = async () => {
        // 頁面不可見或離線時跳過本次輪詢，排程下一次
        if (typeof document !== "undefined" && document.hidden) {
          scheduleNext();
          return;
        }
        if (!isOnlineRef.current) {
          setPollStatus(t.githubConnection.status.networkError);
          scheduleNext();
          return;
        }

        try {
          setPollStatus(
            interpolate(t.githubConnection.status.checking, {
              seconds: currentIntervalRef.current,
            })
          );
          const result = await pollAuthorization(codeRef.current);

          // Session 已被 stopPolling/cancelAuth 作廢，丟棄結果
          if (sessionId !== sessionIdRef.current) return;

          if (result.status === "success") {
            handleSuccess(result.username);
          } else if (result.status === "expired" || result.status === "error") {
            handleError(result.error);
          } else if (result.status === "pending" && result.slow_down && result.interval) {
            const newInterval = result.interval + DEVICE_FLOW_SLOWDOWN_EXTRA_SEC;
            currentIntervalRef.current = newInterval;
            setPollStatus(
              interpolate(t.githubConnection.status.rateLimited, { seconds: newInterval })
            );
            scheduleNext();
          } else {
            setPollStatus(
              interpolate(t.githubConnection.status.waiting, {
                seconds: currentIntervalRef.current,
              })
            );
            scheduleNext();
          }
        } catch (err) {
          if (sessionId !== sessionIdRef.current) return;
          logger.error("[GitHub 驗證] 輪詢錯誤:", err);
          setPollStatus(t.githubConnection.status.networkError);
          scheduleNext();
        }
      };

      initialDelayRef.current = window.setTimeout(doPoll, DEVICE_FLOW_INITIAL_DELAY_MS);
    },
    [t, stopPolling, onExpired, setPollStatus, handleSuccess, handleError]
  );

  // 元件卸載時清理所有 timers
  useEffect(() => {
    return () => {
      if (initialDelayRef.current !== null) {
        clearTimeout(initialDelayRef.current);
      }
      if (nextPollRef.current !== null) {
        clearTimeout(nextPollRef.current);
      }
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, []);

  return { startPolling, stopPolling, resetInterval };
}
