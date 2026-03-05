/**
 * Unit tests for requestCache — cachedRequest with TTL, dedup, and LRU eviction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to clear the module-level Maps between tests, so re-import per test.
// Use vi.resetModules() + dynamic import.

// Constants are stable; import them statically for reference.
import {
  CACHE_DEFAULT_TTL_MS,
  CACHE_EVICTION_THRESHOLD,
  CACHE_TARGET_SIZE_AFTER_EVICTION,
} from "../../constants/cache";

describe("cachedRequest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function loadModule() {
    const mod = await import("../requestCache");
    return mod.cachedRequest;
  }

  // ---------- Cache hit / miss ----------

  it("returns cached data within TTL (cache hit)", async () => {
    const cachedRequest = await loadModule();
    const fetchFn = vi.fn().mockResolvedValue("data-1");

    const first = await cachedRequest("key-a", fetchFn);
    expect(first).toBe("data-1");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Second call within TTL → should NOT call fetchFn again
    const second = await cachedRequest("key-a", fetchFn);
    expect(second).toBe("data-1");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refetches after TTL expires (cache miss)", async () => {
    const cachedRequest = await loadModule();
    const fetchFn = vi.fn().mockResolvedValueOnce("data-1").mockResolvedValueOnce("data-2");

    const first = await cachedRequest("key-b", fetchFn, 1000);
    expect(first).toBe("data-1");

    // Advance time past TTL
    vi.advanceTimersByTime(1001);

    const second = await cachedRequest("key-b", fetchFn, 1000);
    expect(second).toBe("data-2");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("uses default TTL when not specified", async () => {
    const cachedRequest = await loadModule();
    const fetchFn = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");

    await cachedRequest("key-ttl", fetchFn);

    // Just before default TTL → still cached
    vi.advanceTimersByTime(CACHE_DEFAULT_TTL_MS - 1);
    const cached = await cachedRequest("key-ttl", fetchFn);
    expect(cached).toBe("v1");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Advance past default TTL → refetch
    vi.advanceTimersByTime(2);
    const refreshed = await cachedRequest("key-ttl", fetchFn);
    expect(refreshed).toBe("v2");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  // ---------- Request deduplication ----------

  it("deduplicates concurrent requests with the same key", async () => {
    const cachedRequest = await loadModule();

    let resolvePromise!: (value: string) => void;
    const fetchFn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolvePromise = resolve;
        })
    );

    // Fire two requests concurrently
    const p1 = cachedRequest("dedup", fetchFn);
    const p2 = cachedRequest("dedup", fetchFn);

    // fetchFn should be called only once
    expect(fetchFn).toHaveBeenCalledTimes(1);

    resolvePromise("shared-result");

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("shared-result");
    expect(r2).toBe("shared-result");
  });

  it("does not deduplicate requests with different keys", async () => {
    const cachedRequest = await loadModule();
    const fetchA = vi.fn().mockResolvedValue("a");
    const fetchB = vi.fn().mockResolvedValue("b");

    const [ra, rb] = await Promise.all([
      cachedRequest("key-x", fetchA),
      cachedRequest("key-y", fetchB),
    ]);

    expect(ra).toBe("a");
    expect(rb).toBe("b");
    expect(fetchA).toHaveBeenCalledTimes(1);
    expect(fetchB).toHaveBeenCalledTimes(1);
  });

  // ---------- Error handling ----------

  it("does not cache failed requests", async () => {
    const cachedRequest = await loadModule();
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("success");

    // First call fails
    await expect(cachedRequest("err-key", fetchFn)).rejects.toThrow("fail");

    // Second call should retry (not return cached error)
    const result = await cachedRequest("err-key", fetchFn);
    expect(result).toBe("success");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("clears pending request on failure so next call retries", async () => {
    const cachedRequest = await loadModule();
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("recovered");

    await expect(cachedRequest("retry-key", fetchFn)).rejects.toThrow("boom");

    // The pending entry should be cleared, so a new fetch is initiated
    const result = await cachedRequest("retry-key", fetchFn);
    expect(result).toBe("recovered");
  });

  // ---------- LRU eviction ----------

  it("evicts LRU entries when cache exceeds eviction threshold", async () => {
    const cachedRequest = await loadModule();

    // Fill cache to the eviction threshold, advancing time so each entry
    // has a distinct lastAccessed timestamp.
    for (let i = 0; i < CACHE_EVICTION_THRESHOLD; i++) {
      const fn = vi.fn().mockResolvedValue(`val-${i}`);
      await cachedRequest(`fill-${i}`, fn);
      vi.advanceTimersByTime(1);
    }

    // Re-access "fill-0" so it gets the latest lastAccessed timestamp
    vi.advanceTimersByTime(1);
    const refetchFirst = vi.fn().mockResolvedValue("val-0-fresh");
    const val = await cachedRequest("fill-0", refetchFirst);
    expect(val).toBe("val-0");
    expect(refetchFirst).not.toHaveBeenCalled();

    // Add one more entry to trigger eviction
    vi.advanceTimersByTime(1);
    const triggerFn = vi.fn().mockResolvedValue("trigger");
    await cachedRequest("trigger-eviction", triggerFn);

    // "fill-0" was recently accessed, so it should survive eviction.
    const survivedFn = vi.fn().mockResolvedValue("should-not-call");
    const survived = await cachedRequest("fill-0", survivedFn);
    expect(survived).toBe("val-0");
    expect(survivedFn).not.toHaveBeenCalled();

    // "fill-1" was added early and never re-accessed, so it should be evicted.
    const evictedFn = vi.fn().mockResolvedValue("refetched");
    const evicted = await cachedRequest("fill-1", evictedFn);
    expect(evicted).toBe("refetched");
    expect(evictedFn).toHaveBeenCalledTimes(1);
  });

  it("retains TARGET_SIZE_AFTER_EVICTION entries after eviction", async () => {
    const cachedRequest = await loadModule();

    // Fill past the threshold, advancing time per entry
    for (let i = 0; i < CACHE_EVICTION_THRESHOLD + 1; i++) {
      const fn = vi.fn().mockResolvedValue(i);
      await cachedRequest(`size-${i}`, fn);
      vi.advanceTimersByTime(1);
    }

    // After filling EVICTION_THRESHOLD + 1 entries, the last insertion triggered
    // eviction. The cache should now contain TARGET_SIZE_AFTER_EVICTION + 1 entries
    // (TARGET after eviction + the newly inserted trigger entry).
    //
    // The newest entries (highest indices) should survive.
    // Check that the newest entry is still cached (no refetch).
    const newestFn = vi.fn().mockResolvedValue("new");
    await cachedRequest(`size-${CACHE_EVICTION_THRESHOLD}`, newestFn);
    expect(newestFn).not.toHaveBeenCalled();

    // The oldest entry (index 0) should have been evicted.
    const oldestFn = vi.fn().mockResolvedValue("new");
    await cachedRequest("size-0", oldestFn);
    expect(oldestFn).toHaveBeenCalledTimes(1);

    // Eviction removes (cache.size - TARGET) entries from the oldest.
    // At eviction time cache.size = EVICTION_THRESHOLD (240).
    // numEvicted = 240 - 160 = 80. Entries size-0..size-79 are evicted.
    const numEvicted = CACHE_EVICTION_THRESHOLD - CACHE_TARGET_SIZE_AFTER_EVICTION;

    // First surviving entry (just above cutoff)
    const borderFn = vi.fn().mockResolvedValue("new");
    await cachedRequest(`size-${numEvicted}`, borderFn);
    expect(borderFn).not.toHaveBeenCalled();

    // Last evicted entry (just below cutoff)
    const belowBorderFn = vi.fn().mockResolvedValue("new");
    await cachedRequest(`size-${numEvicted - 1}`, belowBorderFn);
    expect(belowBorderFn).toHaveBeenCalledTimes(1);
  });
});
