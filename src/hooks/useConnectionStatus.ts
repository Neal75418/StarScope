/**
 * GitHub 連線狀態查詢。
 * 使用 React Query 管理快取，保留狀態 setter 供上層 hook 控制。
 */

import { useState, useCallback } from "react";
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
    queryFn: async () => {
      setState("loading");
      setError(null);
      try {
        const result = await getGitHubConnectionStatus();
        setState(result.connected ? "connected" : "disconnected");
        return result;
      } catch (err) {
        const message = getErrorMessage(err, genericErrorMessage);
        setError(message);
        setState("error");
        throw err;
      }
    },
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const setStatus = useCallback(
    (newStatus: GitHubConnectionStatus | null) => {
      queryClient.setQueryData(queryKeys.connection.status(), newStatus);
    },
    [queryClient]
  );

  const fetchStatus = useCallback(async () => {
    await query.refetch();
  }, [query]);

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
