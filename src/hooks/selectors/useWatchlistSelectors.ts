/**
 * Watchlist Selector Hooks：精準訂閱 state 的一部分，避免不必要的 re-render。
 */

import { useMemo } from "react";
import { useWatchlistState } from "../../contexts/WatchlistContext";
import type { RepoWithSignals } from "../../api/client";
import { normalizeRepoName } from "../../utils/format";
import type { WatchlistSortKey, SortDirection } from "../useWatchlistSort";

/**
 * 篩選後的 repos（套用分類篩選 + 搜尋篩選）
 * 純 selector — 從 state 讀取 categoryRepoIds，無副作用。
 */
export function useFilteredRepos(): RepoWithSignals[] {
  const state = useWatchlistState();
  const { searchQuery, categoryRepoIds } = state.filters;

  return useMemo(() => {
    let result = state.repos;

    // 套用分類篩選
    if (categoryRepoIds !== null) {
      const idSet = new Set(categoryRepoIds);
      result = result.filter((r) => idSet.has(r.id));
    }

    // 套用搜尋篩選
    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery) {
      const lowerQuery = trimmedQuery.toLowerCase();
      result = result.filter(
        (r) =>
          normalizeRepoName(r.full_name).includes(lowerQuery) ||
          (r.description?.toLowerCase().includes(lowerQuery) ?? false) ||
          (r.language?.toLowerCase().includes(lowerQuery) ?? false)
      );
    }

    return result;
  }, [state.repos, categoryRepoIds, searchQuery]);
}

/**
 * 篩選 + 排序後的 repos。
 * 先套用 useFilteredRepos()，再按指定欄位排序。null 值永遠排最後。
 */
export function useSortedFilteredRepos(
  sortKey: WatchlistSortKey,
  sortDirection: SortDirection
): RepoWithSignals[] {
  const filtered = useFilteredRepos();

  return useMemo(() => {
    const multiplier = sortDirection === "asc" ? 1 : -1;

    return [...filtered].sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);

      // null 永遠排最後
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;

      if (typeof av === "string" && typeof bv === "string") {
        return multiplier * av.localeCompare(bv);
      }

      return multiplier * ((av as number) - (bv as number));
    });
  }, [filtered, sortKey, sortDirection]);
}

function getSortValue(repo: RepoWithSignals, key: WatchlistSortKey): string | number | null {
  switch (key) {
    case "stars":
      return repo.stars;
    case "velocity":
      return repo.velocity;
    case "stars_delta_7d":
      return repo.stars_delta_7d;
    case "acceleration":
      return repo.acceleration;
    case "full_name":
      return repo.full_name;
    case "added_at":
      return new Date(repo.added_at).getTime();
  }
}

/**
 * 當前正在載入的 repo ID（null 表示沒有正在載入）
 */
export function useLoadingRepo(): number | null {
  const state = useWatchlistState();
  return state.loadingState.type === "fetching" ? state.loadingState.repoId : null;
}

/**
 * 是否正在刷新全部 repos
 */
export function useIsRefreshing(): boolean {
  const state = useWatchlistState();
  return state.loadingState.type === "refreshing";
}

/**
 * 是否正在重新計算相似度
 */
export function useIsRecalculating(): boolean {
  const state = useWatchlistState();
  return state.loadingState.type === "recalculating";
}

/**
 * 是否正在初始化
 */
export function useIsInitializing(): boolean {
  const state = useWatchlistState();
  return state.loadingState.type === "initializing";
}
