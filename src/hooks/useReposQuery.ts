/**
 * React Query hook 用於取得 repos 列表
 *
 * 這是使用 React Query 的範例實現，展示如何：
 * - 自動快取資料
 * - 處理載入和錯誤狀態
 * - 自動重試失敗的請求
 * - 避免重複請求
 *
 * 使用方式：
 * ```tsx
 * const { data, isLoading, error, refetch } = useReposQuery();
 * ```
 */

import { useQuery } from "@tanstack/react-query";
import { getRepos } from "../api/client";
import { queryKeys } from "../lib/react-query";
import type { RepoWithSignals } from "../api/types";

export interface UseReposQueryOptions {
  /**
   * 是否啟用此查詢（預設：true）
   * 設為 false 時不會發送請求
   */
  enabled?: boolean;

  /**
   * 客製化的 staleTime（覆寫預設值）
   */
  staleTime?: number;
}

/**
 * 使用 React Query 取得 repos 列表
 *
 * @param options - 查詢選項
 * @returns React Query 結果物件
 *
 * @example
 * ```tsx
 * function WatchlistPage() {
 *   const { data: repos, isLoading, error, refetch } = useReposQuery();
 *
 *   if (isLoading) return <Spinner />;
 *   if (error) return <ErrorMessage error={error} />;
 *
 *   return (
 *     <div>
 *       <button onClick={() => refetch()}>重新整理</button>
 *       {repos.map(repo => <RepoCard key={repo.id} repo={repo} />)}
 *     </div>
 *   );
 * }
 * ```
 */
export function useReposQuery(options: UseReposQueryOptions = {}) {
  return useQuery<RepoWithSignals[], Error>({
    queryKey: queryKeys.repos.lists(),
    queryFn: async () => {
      const response = await getRepos();
      return response.repos;
    },
    enabled: options.enabled ?? true,
    staleTime: options.staleTime,
  });
}

/**
 * 使用範例：在現有元件中逐步遷移
 *
 * 步驟 1：保留現有的 useWatchlist hook，同時使用 useReposQuery
 * ```tsx
 * const { repos, isLoading: oldLoading } = useWatchlist();
 * const { data: queryRepos, isLoading: queryLoading } = useReposQuery();
 *
 * // 優先使用 React Query 的資料（如果可用）
 * const displayRepos = queryRepos ?? repos;
 * const loading = queryLoading || oldLoading;
 * ```
 *
 * 步驟 2：逐步移除 useWatchlist 的依賴
 *
 * 步驟 3：完全遷移後移除 useWatchlist
 */
