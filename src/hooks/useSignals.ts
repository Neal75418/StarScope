/**
 * Hook for managing signals state and data fetching.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  EarlySignal,
  EarlySignalType,
  EarlySignalSeverity,
  SignalSummary,
  listEarlySignals,
  getSignalSummary,
} from "../api/client";
import { getErrorMessage } from "../utils/error";

export function useSignals() {
  const [signals, setSignals] = useState<EarlySignal[]>([]);
  const [summary, setSummary] = useState<SignalSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<EarlySignalType | "">("");
  const [filterSeverity, setFilterSeverity] = useState<EarlySignalSeverity | "">("");
  const [showAcknowledged, setShowAcknowledged] = useState(false);

  // Prevent duplicate fetches from StrictMode
  const isFetchingRef = useRef(false);

  const loadSignals = useCallback(async () => {
    try {
      const response = await listEarlySignals({
        signal_type: filterType || undefined,
        severity: filterSeverity || undefined,
        include_acknowledged: showAcknowledged,
      });
      setSignals(response.signals);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load early signals"));
    }
  }, [filterType, filterSeverity, showAcknowledged]);

  const loadSummary = useCallback(async () => {
    try {
      const data = await getSignalSummary();
      setSummary(data);
    } catch {
      // Summary loading failure is non-critical
    }
  }, []);

  const reload = useCallback(async () => {
    await Promise.all([loadSignals(), loadSummary()]);
  }, [loadSignals, loadSummary]);

  useEffect(() => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    setIsLoading(true);
    reload().finally(() => {
      setIsLoading(false);
      isFetchingRef.current = false;
    });
  }, [reload]);

  return {
    signals,
    summary,
    isLoading,
    error,
    setError,
    filterType,
    setFilterType,
    filterSeverity,
    setFilterSeverity,
    showAcknowledged,
    setShowAcknowledged,
    reload,
  };
}
