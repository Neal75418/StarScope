/**
 * Watchlist 排序 hook：管理排序欄位與方向，localStorage 持久化。
 */

import { useCallback, useState } from "react";
import { STORAGE_KEYS } from "../constants/storage";

export type WatchlistSortKey =
  | "stars"
  | "velocity"
  | "stars_delta_7d"
  | "acceleration"
  | "full_name"
  | "added_at";

export type SortDirection = "asc" | "desc";

interface WatchlistSortState {
  key: WatchlistSortKey;
  direction: SortDirection;
}

const DEFAULT_SORT: WatchlistSortState = {
  key: "added_at",
  direction: "desc",
};

// 這些欄位預設用升序（名稱是 A-Z、加入時間是最早優先）
const ASC_DEFAULT_KEYS: Set<WatchlistSortKey> = new Set(["full_name"]);

function loadSort(): WatchlistSortState {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.WATCHLIST_SORT);
    if (raw) {
      const parsed = JSON.parse(raw) as WatchlistSortState;
      if (parsed.key && parsed.direction) return parsed;
    }
  } catch {
    // 忽略
  }
  return DEFAULT_SORT;
}

function saveSort(state: WatchlistSortState): void {
  try {
    localStorage.setItem(STORAGE_KEYS.WATCHLIST_SORT, JSON.stringify(state));
  } catch {
    // 忽略
  }
}

export function useWatchlistSort() {
  const [sort, setSortState] = useState<WatchlistSortState>(loadSort);

  const setSort = useCallback((key: WatchlistSortKey) => {
    setSortState((prev) => {
      let next: WatchlistSortState;
      if (prev.key === key) {
        // 同一欄位：切換方向
        next = { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      } else {
        // 不同欄位：使用該欄位的預設方向
        next = { key, direction: ASC_DEFAULT_KEYS.has(key) ? "asc" : "desc" };
      }
      saveSort(next);
      return next;
    });
  }, []);

  const restoreSort = useCallback((key: WatchlistSortKey, direction: SortDirection) => {
    const next: WatchlistSortState = { key, direction };
    setSortState(next);
    saveSort(next);
  }, []);

  return {
    sortKey: sort.key,
    sortDirection: sort.direction,
    setSort,
    restoreSort,
  };
}
