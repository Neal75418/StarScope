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

interface SummaryOperationArgs<T> {
  isMountedRef: BooleanRef;
  setActive: SetState<boolean>;
  setError: SetState<string | null>;
  setSummary: SetState<T | null>;
  failedToLoadMessage: string;
  logPrefix: string;
  logAction: string;
  operation: () => Promise<T>;
  /** 若為 true，404 錯誤會將 summary 設為 null 而非顯示錯誤 */
  handleNotFound?: boolean;
}

async function executeSummaryOp<T>({
  isMountedRef,
  setActive,
  setError,
  setSummary,
  failedToLoadMessage,
  logPrefix,
  logAction,
  operation,
  handleNotFound,
}: SummaryOperationArgs<T>): Promise<void> {
  setIfMounted(isMountedRef, setActive, true);
  setIfMounted(isMountedRef, setError, null);

  try {
    const data = await operation();
    setIfMounted(isMountedRef, setSummary, data);
  } catch (err) {
    if (!isMountedRef.current) return;

    if (handleNotFound && isNotFoundError(err)) {
      setIfMounted(isMountedRef, setSummary, null);
    } else {
      setIfMounted(isMountedRef, setError, failedToLoadMessage);
      logger.error(`[${logPrefix}] ${logAction}:`, err);
    }
  } finally {
    setIfMounted(isMountedRef, setActive, false);
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
    void executeSummaryOp({
      isMountedRef,
      setActive: setLoading,
      setError,
      setSummary,
      failedToLoadMessage,
      logPrefix,
      logAction: "載入錯誤",
      operation: () => getSummary(repoId),
      handleNotFound: true,
    });

    return () => {
      isMountedRef.current = false;
    };
    // 只監聽 repoId - 其他參數不應觸發重新請求
    // failedToLoadMessage, getSummary, triggerFetch, logPrefix 是配置參數，不影響數據載入邏輯
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  const fetchData = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setFetching(true);
    try {
      await executeSummaryOp({
        isMountedRef,
        setActive: setFetching,
        setError,
        setSummary,
        failedToLoadMessage,
        logPrefix,
        logAction: "取得資料錯誤",
        operation: async () => {
          await triggerFetch(repoId);
          return getSummary(repoId);
        },
      });
    } finally {
      fetchingRef.current = false;
    }
    // 只監聽 repoId - 其他參數是穩定的配置，不需要重新創建 callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  return { summary, loading, fetching, error, fetchData };
}
