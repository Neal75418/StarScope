/**
 * Hook for managing polling interval and timeout refs.
 */

import { useRef, useEffect, useCallback, RefObject } from "react";

interface UsePollingRefsResult {
  pollIntervalRef: RefObject<number | null>;
  pollTimeoutRef: RefObject<number | null>;
  currentIntervalRef: RefObject<number>;
  stopPolling: () => void;
  resetInterval: () => void;
}

const DEFAULT_INTERVAL = 10;

export function usePollingRefs(): UsePollingRefsResult {
  const pollIntervalRef = useRef<number | null>(null);
  const pollTimeoutRef = useRef<number | null>(null);
  const currentIntervalRef = useRef<number>(DEFAULT_INTERVAL);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const resetInterval = useCallback(() => {
    currentIntervalRef.current = DEFAULT_INTERVAL;
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, []);

  return {
    pollIntervalRef,
    pollTimeoutRef,
    currentIntervalRef,
    stopPolling,
    resetInterval,
  };
}
