/**
 * Watchlist Selector Hooks：精準訂閱 state 的一部分，避免不必要的 re-render。
 */

import { useMemo } from "react";
import { useWatchlistState } from "../../contexts/WatchlistContext";
import type { RepoWithSignals } from "../../api/client";

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
          r.full_name.toLowerCase().includes(lowerQuery) ||
          (r.description?.toLowerCase().includes(lowerQuery) ?? false) ||
          (r.language?.toLowerCase().includes(lowerQuery) ?? false)
      );
    }

    return result;
  }, [state.repos, categoryRepoIds, searchQuery]);
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
 * 根據 ID 取得單一 repo（只在該 repo 變更時才 re-render）
 */
export function useRepoById(repoId: number): RepoWithSignals | undefined {
  const state = useWatchlistState();
  return useMemo(() => state.repos.find((r) => r.id === repoId), [state.repos, repoId]);
}

/**
 * 取得 dialog 狀態
 */
export function useDialogState() {
  const state = useWatchlistState();
  return state.ui.dialog;
}

/**
 * 取得 removeConfirm 狀態
 */
export function useRemoveConfirmState() {
  const state = useWatchlistState();
  return state.ui.removeConfirm;
}

/**
 * 取得 toasts
 */
export function useToasts() {
  const state = useWatchlistState();
  return state.toasts;
}

/**
 * 是否正在初始化
 */
export function useIsInitializing(): boolean {
  const state = useWatchlistState();
  return state.loadingState.type === "initializing";
}
