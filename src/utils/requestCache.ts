/**
 * API 請求的 cache 與去重機制。
 * 防止重複的並發請求，並在短 TTL 內快取回應。
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  lastAccessed: number; // For LRU eviction
}

interface PendingRequest<T> {
  promise: Promise<T>;
}

// 預設 TTL 為 30 秒
const DEFAULT_TTL_MS = 30 * 1000;

// Cache 最大條目數，超過時淘汰最久未使用的條目 (LRU)
const MAX_CACHE_SIZE = 200;
const EVICTION_THRESHOLD = Math.floor(MAX_CACHE_SIZE * 1.2); // 240
const TARGET_SIZE_AFTER_EVICTION = Math.floor(MAX_CACHE_SIZE * 0.8); // 160

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
  const now = Date.now();

  // 先檢查 cache
  const cached = cache.get(key) as CacheEntry<T> | undefined;
  if (cached && now - cached.timestamp < ttlMs) {
    // Update last accessed time for LRU
    cached.lastAccessed = now;
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
      const timestamp = Date.now();
      // 快取回應
      cache.set(key, { data, timestamp, lastAccessed: timestamp });

      // LRU 淘汰策略：當超過閾值時，批量清理到目標大小
      if (cache.size > EVICTION_THRESHOLD) {
        evictLRU();
      }

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
 * LRU 淘汰：移除最久未使用的條目直到達到目標大小。
 */
function evictLRU(): void {
  const entries = Array.from(cache.entries()).map(([key, entry]) => ({
    key,
    lastAccessed: entry.lastAccessed,
  }));

  // 按最後存取時間排序（最舊的在前）
  entries.sort((a, b) => a.lastAccessed - b.lastAccessed);

  // 刪除最久未使用的條目
  const toDelete = entries.length - TARGET_SIZE_AFTER_EVICTION;
  for (let i = 0; i < toDelete; i++) {
    cache.delete(entries[i].key);
  }
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
