/**
 * GitHub 連線狀態查詢，含 StrictMode 防重複請求。
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { getGitHubConnectionStatus, GitHubConnectionStatus } from "../api/client";
import { getErrorMessage } from "../utils/error";
import { useI18n } from "../i18n";
import { ConnectionState } from "./useGitHubConnection";

interface UseConnectionStatusResult {
  status: GitHubConnectionStatus | null;
  setStatus: (status: GitHubConnectionStatus | null) => void;
  state: ConnectionState;
  setState: (state: ConnectionState) => void;
  error: string | null;
  setError: (error: string | null) => void;
  fetchStatus: () => Promise<void>;
}

export function useConnectionStatus(): UseConnectionStatusResult {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitHubConnectionStatus | null>(null);
  const [state, setState] = useState<ConnectionState>("loading");
  const [error, setError] = useState<string | null>(null);

  // 避免 StrictMode 重複請求
  const isFetchingRef = useRef(false);
  const hasFetchedRef = useRef(false);

  // 僅取用特定錯誤訊息，避免依賴整個 t 物件
  const genericErrorMessage = t.githubConnection.errors.generic;

  const fetchStatus = useCallback(async () => {
    // 避免重複請求（防止 StrictMode 雙重觸發）
    if (isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;
    setState("loading");
    setError(null);

    try {
      const result = await getGitHubConnectionStatus();
      setStatus(result);
      setState(result.connected ? "connected" : "disconnected");
    } catch (err) {
      setError(getErrorMessage(err, genericErrorMessage));
      setState("error");
    } finally {
      isFetchingRef.current = false;
    }
  }, [genericErrorMessage]);

  // 僅在掛載時請求，含 StrictMode 去重
  useEffect(() => {
    // 已在首次掛載時請求過（StrictMode 會執行兩次）
    if (hasFetchedRef.current) {
      return;
    }
    hasFetchedRef.current = true;
    void fetchStatus();
    // fetchStatus 不需加入 deps：只需掛載時執行一次，hasFetchedRef 防止重複
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, setStatus, state, setState, error, setError, fetchStatus };
}
