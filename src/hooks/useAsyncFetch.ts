/**
 * Generic hook for async data fetching with cleanup.
 */

import { useState, useEffect, useRef } from "react";

interface UseAsyncFetchResult<T> {
  data: T;
  loading: boolean;
}

export function useAsyncFetch<T, R>(
  fetchFn: () => Promise<R>,
  extractData: (response: R) => T,
  initialData: T,
  deps: readonly unknown[],
  errorContext: string
): UseAsyncFetchResult<T> {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);

  // Prevent duplicate fetches from StrictMode
  const isFetchingRef = useRef(false);

  useEffect(() => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    let isMounted = true;
    setLoading(true);

    fetchFn()
      .then((response) => {
        if (isMounted) setData(extractData(response));
      })
      .catch((err) => {
        if (isMounted) console.error(`Failed to load ${errorContext}:`, err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
        isFetchingRef.current = false;
      });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading };
}
