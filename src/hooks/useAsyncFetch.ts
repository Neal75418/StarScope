/**
 * 通用非同步資料取得，含清理與可選快取。
 */

import { useState, useEffect } from "react";
import { cachedRequest } from "../utils/requestCache";
import { logger } from "../utils/logger";

interface UseAsyncFetchResult<T> {
  data: T;
  loading: boolean;
}

interface UseAsyncFetchOptions {
  /** 快取 key，用於請求去重。提供此值即啟用快取。 */
  cacheKey?: string;
  /** 快取 TTL（毫秒，預設 30 秒） */
  cacheTtlMs?: number;
}

export function useAsyncFetch<T, R>(
  fetchFn: () => Promise<R>,
  extractData: (response: R) => T,
  initialData: T,
  deps: readonly unknown[],
  errorContext: string,
  options?: UseAsyncFetchOptions
): UseAsyncFetchResult<T> {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const doFetch = async () => {
      try {
        let response: R;
        if (options?.cacheKey) {
          // 使用快取請求（含去重）
          response = await cachedRequest(options.cacheKey, fetchFn, options.cacheTtlMs);
        } else {
          // 直接請求，不使用快取
          response = await fetchFn();
        }
        if (isMounted) setData(extractData(response));
      } catch (err) {
        if (isMounted) logger.error(`${errorContext} 載入失敗:`, err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void doFetch();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading };
}
