/**
 * GitHub OAuth Device Flow 連線管理。
 */

import { useState, useCallback } from "react";
import { safeOpenUrl } from "../utils/url";
import { initiateDeviceFlow, disconnectGitHub, DeviceCodeResponse } from "../api/client";
import { getErrorMessage } from "../utils/error";
import { useI18n } from "../i18n";
import { useConnectionStatus } from "./useConnectionStatus";
import { useUserCodeActions } from "./useUserCodeActions";
import { useDeviceFlowPolling } from "./useDeviceFlowPolling";
import { logger } from "../utils/logger";

export type ConnectionState =
  | "loading"
  | "disconnected"
  | "connecting"
  | "awaiting_auth"
  | "connected"
  | "error";

interface UseGitHubConnectionResult {
  state: ConnectionState;
  status: ReturnType<typeof useConnectionStatus>["status"];
  deviceCode: DeviceCodeResponse | null;
  error: string | null;
  pollStatus: string;
  copied: boolean;
  fetchStatus: () => Promise<void>;
  startDeviceFlow: () => Promise<void>;
  cancelAuth: () => void;
  handleDisconnect: () => Promise<void>;
  copyUserCode: () => void;
  openGitHubManually: () => Promise<void>;
  clearError: () => void;
}

export function useGitHubConnection(): UseGitHubConnectionResult {
  const { t } = useI18n();
  const { status, setStatus, state, setState, error, setError, setAuthActive, fetchStatus } =
    useConnectionStatus();
  const [deviceCode, setDeviceCode] = useState<DeviceCodeResponse | null>(null);
  const [pollStatus, setPollStatus] = useState<string>("");

  const { copied, copyUserCode, openGitHubManually } = useUserCodeActions(deviceCode);

  const handlePollingSuccess = useCallback(
    (newStatus: typeof status) => {
      setAuthActive(false);
      setDeviceCode(null);
      setStatus(newStatus);
      setState("connected");
    },
    [setAuthActive, setStatus, setState]
  );

  const handlePollingError = useCallback(
    (errorMessage: string) => {
      setAuthActive(false);
      setError(errorMessage);
      setState("disconnected");
      setDeviceCode(null);
    },
    [setAuthActive, setError, setState]
  );

  const handlePollingExpired = useCallback(() => {
    setAuthActive(false);
    setError(t.githubConnection.errors.expired);
    setState("disconnected");
    setDeviceCode(null);
  }, [t, setAuthActive, setError, setState]);

  const { startPolling, stopPolling, resetInterval } = useDeviceFlowPolling({
    onSuccess: handlePollingSuccess,
    onError: handlePollingError,
    onExpired: handlePollingExpired,
    setPollStatus,
  });

  const startDeviceFlow = useCallback(async () => {
    setAuthActive(true);
    setState("connecting");
    setError(null);
    setPollStatus("");
    resetInterval();

    try {
      const result = await initiateDeviceFlow();
      setDeviceCode(result);
      setState("awaiting_auth");

      try {
        await safeOpenUrl(result.verification_uri);
      } catch (openErr) {
        logger.warn("[GitHubConnection] 自動開啟瀏覽器失敗:", openErr);
      }

      startPolling(result.device_code, result.interval, result.expires_in);
    } catch (err) {
      setAuthActive(false);
      setError(getErrorMessage(err, t.githubConnection.errors.generic));
      setState("error");
    }
  }, [t, setAuthActive, setState, setError, startPolling, resetInterval]);

  const cancelAuth = useCallback(() => {
    setAuthActive(false);
    stopPolling();
    setDeviceCode(null);
    setPollStatus("");
    setState("disconnected");
  }, [setAuthActive, stopPolling, setState]);

  const handleDisconnect = useCallback(async () => {
    setAuthActive(false);
    setState("loading");
    setError(null);

    try {
      await disconnectGitHub();
      setStatus(null);
      setState("disconnected");
    } catch (err) {
      setError(getErrorMessage(err, t.githubConnection.errors.generic));
      setState("error");
    }
  }, [t, setAuthActive, setState, setError, setStatus]);

  const clearError = useCallback(() => setError(null), [setError]);

  return {
    state,
    status,
    deviceCode,
    error,
    pollStatus,
    copied,
    fetchStatus,
    startDeviceFlow,
    cancelAuth,
    handleDisconnect,
    copyUserCode,
    openGitHubManually,
    clearError,
  };
}
