/**
 * API 請求快取設定常量。
 */

/** 快取條目的預設存活時間（毫秒）。30 秒足以避免短時間內重複請求。 */
export const CACHE_DEFAULT_TTL_MS = 30_000;

/** 快取最大條目數。以 100-repo watchlist 估算約佔 ~10MB 記憶體。 */
export const CACHE_MAX_SIZE = 200;

/** 超過此數量時觸發 LRU 淘汰（MAX_SIZE × 1.2 = 240）。 */
export const CACHE_EVICTION_THRESHOLD = Math.floor(CACHE_MAX_SIZE * 1.2);

/** 淘汰後的目標大小（MAX_SIZE × 0.8 = 160），減少頻繁 GC。 */
export const CACHE_TARGET_SIZE_AFTER_EVICTION = Math.floor(CACHE_MAX_SIZE * 0.8);
