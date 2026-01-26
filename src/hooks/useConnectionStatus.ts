/**
 * Hook for fetching GitHub connection status.
 * Includes deduplication to prevent double fetches from React StrictMode.
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

  // Prevent duplicate fetches from StrictMode double-invocation
  const isFetchingRef = useRef(false);
  const hasFetchedRef = useRef(false);

  // Extract specific error message to avoid depending on entire t object
  const genericErrorMessage = t.githubConnection.errors.generic;

  const fetchStatus = useCallback(async () => {
    // Skip if already fetching (prevents StrictMode double-fetch)
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

  // Only fetch on mount, with StrictMode deduplication
  useEffect(() => {
    // Skip if already fetched on initial mount (StrictMode runs twice)
    if (hasFetchedRef.current) {
      return;
    }
    hasFetchedRef.current = true;
    void fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, setStatus, state, setState, error, setError, fetchStatus };
}
