/**
 * API 請求的 cache 與去重機制。
 * 防止重複的並發請求，並在短 TTL 內快取回應。
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface PendingRequest<T> {
  promise: Promise<T>;
}

// 預設 TTL 為 30 秒
const DEFAULT_TTL_MS = 30 * 1000;

// 記憶體內的回應 cache
const cache = new Map<string, CacheEntry<unknown>>();

// 進行中的請求，用於去重
const pendingRequests = new Map<string, PendingRequest<unknown>>();

/**
 * 執行帶有快取與去重的請求。
 *
 * @param key - 此請求的唯一 cache key
 * @param fetchFn - 回傳資料 Promise 的函式
 * @param ttlMs - cache TTL（毫秒，預設 30 秒）
 * @returns 快取或最新的資料
 */
export async function cachedRequest<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  // 先檢查 cache
  const cached = cache.get(key) as CacheEntry<T> | undefined;
  if (cached && Date.now() - cached.timestamp < ttlMs) {
    return cached.data;
  }

  // 檢查請求是否已在進行中
  const pending = pendingRequests.get(key) as PendingRequest<T> | undefined;
  if (pending) {
    return pending.promise;
  }

  // 建立新請求
  const promise = fetchFn()
    .then((data) => {
      // 快取回應
      cache.set(key, { data, timestamp: Date.now() });
      return data;
    })
    .finally(() => {
      // 無論成功或失敗，都從待處理中移除
      pendingRequests.delete(key);
    });

  // 標記為進行中
  pendingRequests.set(key, { promise });

  return promise;
}

/**
 * 使特定 cache 項目失效。
 */
export function invalidateCache(key: string): void {
  cache.delete(key);
}

/**
 * 使所有符合前綴的 cache 項目失效。
 */
export function invalidateCacheByPrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * 清除整個 cache 與待處理請求。
 * 適用於測試時確保乾淨的狀態。
 */
export function clearCache(): void {
  cache.clear();
  pendingRequests.clear();
}

/**
 * 取得 cache 統計資訊（供除錯用）。
 */
export function getCacheStats(): { cacheSize: number; pendingRequests: number } {
  return {
    cacheSize: cache.size,
    pendingRequests: pendingRequests.size,
  };
}
