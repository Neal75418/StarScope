/**
 * Generic hook for async data fetching with cleanup and optional caching.
 */

import { useState, useEffect } from "react";
import { cachedRequest } from "../utils/requestCache";

interface UseAsyncFetchResult<T> {
  data: T;
  loading: boolean;
}

interface UseAsyncFetchOptions {
  /** Cache key for request deduplication. If provided, enables caching. */
  cacheKey?: string;
  /** Cache TTL in milliseconds (default: 30s) */
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
          // Use cached request with deduplication
          response = await cachedRequest(options.cacheKey, fetchFn, options.cacheTtlMs);
        } else {
          // Direct fetch without caching
          response = await fetchFn();
        }
        if (isMounted) setData(extractData(response));
      } catch (err) {
        if (isMounted) console.error(`Failed to load ${errorContext}:`, err);
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
