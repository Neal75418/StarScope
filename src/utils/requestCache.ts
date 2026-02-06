/**
 * Request cache for deduplicating and caching API requests.
 * Prevents duplicate concurrent requests and caches responses for a short TTL.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface PendingRequest<T> {
  promise: Promise<T>;
}

// Default TTL of 30 seconds
const DEFAULT_TTL_MS = 30 * 1000;

// In-memory cache for responses
const cache = new Map<string, CacheEntry<unknown>>();

// In-flight requests for deduplication
const pendingRequests = new Map<string, PendingRequest<unknown>>();

/**
 * Execute a request with caching and deduplication.
 *
 * @param key - Unique cache key for this request
 * @param fetchFn - Function that returns a Promise with the data
 * @param ttlMs - Cache TTL in milliseconds (default: 30s)
 * @returns Cached or fresh data
 */
export async function cachedRequest<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  // Check cache first
  const cached = cache.get(key) as CacheEntry<T> | undefined;
  if (cached && Date.now() - cached.timestamp < ttlMs) {
    return cached.data;
  }

  // Check if request is already in-flight
  const pending = pendingRequests.get(key) as PendingRequest<T> | undefined;
  if (pending) {
    return pending.promise;
  }

  // Create new request
  const promise = fetchFn()
    .then((data) => {
      // Cache the response
      cache.set(key, { data, timestamp: Date.now() });
      return data;
    })
    .finally(() => {
      // Remove from pending regardless of success/failure
      pendingRequests.delete(key);
    });

  // Track as pending
  pendingRequests.set(key, { promise });

  return promise;
}

/**
 * Invalidate a specific cache entry.
 */
export function invalidateCache(key: string): void {
  cache.delete(key);
}

/**
 * Invalidate all cache entries matching a prefix.
 */
export function invalidateCacheByPrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Clear the entire cache and pending requests.
 * Useful for testing to ensure a clean state between tests.
 */
export function clearCache(): void {
  cache.clear();
  pendingRequests.clear();
}

/**
 * Get cache statistics for debugging.
 */
export function getCacheStats(): { cacheSize: number; pendingRequests: number } {
  return {
    cacheSize: cache.size,
    pendingRequests: pendingRequests.size,
  };
}
