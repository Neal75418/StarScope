/**
 * Watchlist URL 同步：將排序、分類、搜尋狀態序列化到 URL hash。
 * Hash 格式：#w:cat=5&q=react&sort=velocity&dir=desc
 */

import { useEffect, useRef, useState } from "react";
import type { WatchlistSortKey, SortDirection } from "./useWatchlistSort";

const HASH_PREFIX = "w:";

interface WatchlistUrlState {
  categoryId: number | null;
  searchQuery: string;
  sortKey: WatchlistSortKey;
  sortDirection: SortDirection;
}

interface UseWatchlistUrlOptions {
  categoryId: number | null;
  searchQuery: string;
  sortKey: WatchlistSortKey;
  sortDirection: SortDirection;
  onRestoreState: (state: WatchlistUrlState) => void;
}

const VALID_SORT_KEYS: Set<string> = new Set([
  "stars",
  "velocity",
  "stars_delta_7d",
  "acceleration",
  "full_name",
  "added_at",
]);

function serializeToHash(state: WatchlistUrlState): string {
  const params = new URLSearchParams();
  if (state.categoryId != null) params.set("cat", String(state.categoryId));
  if (state.searchQuery) params.set("q", state.searchQuery);
  if (state.sortKey !== "added_at") params.set("sort", state.sortKey);
  if (state.sortDirection !== "desc") params.set("dir", state.sortDirection);

  const str = params.toString();
  return str ? `#${HASH_PREFIX}${str}` : "";
}

function deserializeFromHash(hash: string): WatchlistUrlState | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(HASH_PREFIX)) return null;

  const paramStr = raw.slice(HASH_PREFIX.length);
  if (!paramStr) return null;

  const params = new URLSearchParams(paramStr);
  if (params.size === 0) return null;

  const catRaw = params.get("cat");
  const categoryId = catRaw ? Number(catRaw) : null;
  if (catRaw && (isNaN(categoryId as number) || categoryId === 0)) return null;

  const searchQuery = params.get("q") ?? "";
  const sortRaw = params.get("sort") ?? "added_at";
  const sortKey: WatchlistSortKey = VALID_SORT_KEYS.has(sortRaw)
    ? (sortRaw as WatchlistSortKey)
    : "added_at";
  const dirRaw = params.get("dir");
  const sortDirection: SortDirection = dirRaw === "asc" ? "asc" : "desc";

  return { categoryId, searchQuery, sortKey, sortDirection };
}

export function useWatchlistUrl({
  categoryId,
  searchQuery,
  sortKey,
  sortDirection,
  onRestoreState,
}: UseWatchlistUrlOptions) {
  const isSyncingRef = useRef(false);
  const [hasUrlParams, setHasUrlParams] = useState(false);
  const initializedRef = useRef(false);
  const restoreRef = useRef(onRestoreState);
  restoreRef.current = onRestoreState;

  // 初始化：mount 時如果 hash 有 watchlist 參數 → 恢復狀態
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const restored = deserializeFromHash(window.location.hash);
    if (restored) {
      setHasUrlParams(true);
      isSyncingRef.current = true;
      restoreRef.current(restored);
      // 使用 microtask 確保 sync flag 在 React batch update 完成後、
      // 下一個 useEffect 執行前重置，避免 rAF 延遲到下一幀的 race condition
      queueMicrotask(() => {
        isSyncingRef.current = false;
      });
    }
  }, []);

  // State → URL：狀態變更時更新 hash
  useEffect(() => {
    if (isSyncingRef.current) return;

    const hasState =
      categoryId != null || searchQuery || sortKey !== "added_at" || sortDirection !== "desc";
    if (!hasState) {
      // 只在 hash 是 watchlist 的時候清除
      if (window.location.hash.startsWith(`#${HASH_PREFIX}`)) {
        window.history.replaceState(null, "", window.location.pathname);
      }
      return;
    }

    const newHash = serializeToHash({ categoryId, searchQuery, sortKey, sortDirection });
    const currentHash = window.location.hash || "";
    if (newHash !== currentHash) {
      window.history.replaceState(null, "", newHash || window.location.pathname);
    }
  }, [categoryId, searchQuery, sortKey, sortDirection]);

  // hashchange 事件：瀏覽器前進/後退時恢復
  useEffect(() => {
    function handleHashChange() {
      if (isSyncingRef.current) return;

      const restored = deserializeFromHash(window.location.hash);
      if (restored) {
        isSyncingRef.current = true;
        restoreRef.current(restored);
        requestAnimationFrame(() => {
          isSyncingRef.current = false;
        });
      }
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return { hasUrlParams };
}

// 匯出 helper 以便測試
export { serializeToHash as _serializeToHash, deserializeFromHash as _deserializeFromHash };
