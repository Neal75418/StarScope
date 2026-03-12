/**
 * GitHub 連線狀態查詢。
 * 使用 React Query 管理快取，保留狀態 setter 供上層 hook 控制。
 *
 * 注意：queryFn 必須是純函式（只做資料擷取），不可在其中呼叫 setState。
 * React Query 的 queryFn closure 可能捕獲到過期的 setState reference，
 * 導致狀態更新遺失。改用 useEffect 同步 React Query 狀態至手動 state。
 */

import { useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getGitHubConnectionStatus, GitHubConnectionStatus } from "../api/client";
import { getErrorMessage } from "../utils/error";
import { useI18n } from "../i18n";
import { ConnectionState } from "./useGitHubConnection";
import { queryKeys } from "../lib/react-query";

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
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>("loading");
  const [error, setError] = useState<string | null>(null);

  const genericErrorMessage = t.githubConnection.errors.generic;

  const query = useQuery<GitHubConnectionStatus | null, Error>({
    queryKey: queryKeys.connection.status(),
    queryFn: getGitHubConnectionStatus,
    retry: false,
  });

  // 同步 React Query 狀態至手動 state，確保 useEffect 的 setState
  // 一定指向當前 component instance（避免 strict mode 下 closure 失效）
  useEffect(() => {
    if (query.isSuccess && query.data != null) {
      setState(query.data.connected ? "connected" : "disconnected");
      setError(null);
    } else if (query.isError) {
      setError(getErrorMessage(query.error, genericErrorMessage));
      setState("error");
    }
  }, [query.isSuccess, query.isError, query.data, query.error, genericErrorMessage]);

  const setStatus = useCallback(
    (newStatus: GitHubConnectionStatus | null) => {
      queryClient.setQueryData(queryKeys.connection.status(), newStatus);
    },
    [queryClient]
  );

  const fetchStatus = useCallback(async () => {
    setState("loading");
    setError(null);
    await queryClient.refetchQueries({ queryKey: queryKeys.connection.status() });
  }, [queryClient]);

  return {
    status: query.data ?? null,
    setStatus,
    state,
    setState,
    error,
    setError,
    fetchStatus,
  };
}
