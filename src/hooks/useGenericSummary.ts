/**
 * 通用摘要資料取得，含 loading / error 狀態管理。
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { logger } from "../utils/logger";

export interface UseGenericSummaryResult<T> {
  summary: T | null;
  loading: boolean;
  fetching: boolean;
  error: string | null;
  fetchData: () => Promise<void>;
}

type SetState<T> = Dispatch<SetStateAction<T>>;
type BooleanRef = { current: boolean };

export function isNotFoundError(err: unknown): boolean {
  return (err as { status?: number })?.status === 404;
}

export function setIfMounted<T>(isMountedRef: BooleanRef, setter: SetState<T>, value: T): void {
  if (isMountedRef.current) {
    setter(value);
  }
}

interface GenericSummaryConfig<T> {
  repoId: number;
  failedToLoadMessage: string;
  getSummary: (repoId: number) => Promise<T>;
  triggerFetch: (repoId: number) => Promise<unknown>;
  logPrefix: string;
}

async function loadSummary<T>({
  repoId,
  failedToLoadMessage,
  getSummary,
  logPrefix,
  isMountedRef,
  setSummary,
  setLoading,
  setError,
}: GenericSummaryConfig<T> & {
  isMountedRef: BooleanRef;
  setSummary: SetState<T | null>;
  setLoading: SetState<boolean>;
  setError: SetState<string | null>;
}): Promise<void> {
  setIfMounted(isMountedRef, setLoading, true);
  setIfMounted(isMountedRef, setError, null);

  try {
    const data = await getSummary(repoId);
    setIfMounted(isMountedRef, setSummary, data);
  } catch (err) {
    if (!isMountedRef.current) {
      return;
    }

    if (isNotFoundError(err)) {
      setIfMounted(isMountedRef, setSummary, null);
    } else {
      setIfMounted(isMountedRef, setError, failedToLoadMessage);
      logger.error(`[${logPrefix}] 載入錯誤:`, err);
    }
  } finally {
    setIfMounted(isMountedRef, setLoading, false);
  }
}

async function fetchSummaryData<T>({
  repoId,
  failedToLoadMessage,
  getSummary,
  triggerFetch,
  logPrefix,
  isMountedRef,
  setSummary,
  setFetching,
  setError,
}: GenericSummaryConfig<T> & {
  isMountedRef: BooleanRef;
  setSummary: SetState<T | null>;
  setFetching: SetState<boolean>;
  setError: SetState<string | null>;
}): Promise<void> {
  setIfMounted(isMountedRef, setFetching, true);
  setIfMounted(isMountedRef, setError, null);

  try {
    await triggerFetch(repoId);
    const summaryData = await getSummary(repoId);
    setIfMounted(isMountedRef, setSummary, summaryData);
  } catch (err) {
    setIfMounted(isMountedRef, setError, failedToLoadMessage);
    logger.error(`[${logPrefix}] 取得資料錯誤:`, err);
  } finally {
    setIfMounted(isMountedRef, setFetching, false);
  }
}

export function useGenericSummary<T>(config: GenericSummaryConfig<T>): UseGenericSummaryResult<T> {
  const { repoId, failedToLoadMessage, getSummary, triggerFetch, logPrefix } = config;

  const [summary, setSummary] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  // 透過 ref 追蹤 fetching 狀態，保持 fetchData callback 穩定
  const fetchingRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    void loadSummary({
      repoId,
      failedToLoadMessage,
      getSummary,
      triggerFetch,
      logPrefix,
      isMountedRef,
      setSummary,
      setLoading,
      setError,
    });

    return () => {
      isMountedRef.current = false;
    };
  }, [repoId, failedToLoadMessage, getSummary, triggerFetch, logPrefix]);

  const fetchData = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setFetching(true);
    try {
      await fetchSummaryData({
        repoId,
        failedToLoadMessage,
        getSummary,
        triggerFetch,
        logPrefix,
        isMountedRef,
        setSummary,
        setFetching,
        setError,
      });
    } finally {
      fetchingRef.current = false;
    }
  }, [repoId, failedToLoadMessage, getSummary, triggerFetch, logPrefix]);

  return { summary, loading, fetching, error, fetchData };
}
