/**
 * Watchlist Selector Hooks：精準訂閱 state 的一部分，避免不必要的 re-render。
 */

import { useMemo } from "react";
import { useWatchlistState } from "../../contexts/WatchlistContext";
import type { RepoWithSignals } from "../../api/client";
import { normalizeRepoName } from "../../utils/format";
import type { WatchlistSortKey, SortDirection } from "../useWatchlistSort";
import { relativeDelta } from "../../utils/relativeDelta";

/**
 * 篩選後的 repos（套用分類篩選 + 搜尋篩選）
 * 純 selector — 從 state 讀取 categoryRepoIds，無副作用。
 * 僅供檔內 useSortedFilteredRepos 組合使用，故不 export。
 */
function useFilteredRepos(): RepoWithSignals[] {
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

const ALL_SORT_KEYS: WatchlistSortKey[] = [
  "stars",
  "velocity",
  "stars_delta_7d",
  "relative_7d",
  "acceleration",
  "full_name",
  "added_at",
];

/**
 * 找出每一筆都沒有值的排序鍵。
 *
 * 按這種鍵排序，順序一個都不會動（null 全部排到最後），但按鈕會亮起方向箭頭，
 * 看起來像生效了。acceleration 需要 14 天前的快照、30 天增量需要 30 天前的——
 * 新裝的資料庫在累積夠歷史之前這些鍵是空的，補齊後這個清單會自己變空。
 *
 * 刻意共用 getSortValue：換一份寫法的話，「排序看到的值」和「判斷有沒有值」
 * 會各自漂移，然後某個鍵明明排得動卻被停用。
 */
export function findEmptySortKeys(repos: RepoWithSignals[]): WatchlistSortKey[] {
  if (repos.length === 0) return [];
  return ALL_SORT_KEYS.filter((key) => repos.every((repo) => getSortValue(repo, key) === null));
}

function getSortValue(repo: RepoWithSignals, key: WatchlistSortKey): string | number | null {
  switch (key) {
    case "stars":
      return repo.stars;
    case "velocity":
      return repo.velocity;
    case "stars_delta_7d":
      return repo.stars_delta_7d;
    // 這份清單從 1K 到 400K 星都有，絕對增量排出來永遠是大專案在前面。
    // 期初為零的會回 null，照既有規則排到最後
    case "relative_7d":
      return relativeDelta(repo.stars, repo.stars_delta_7d);
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
