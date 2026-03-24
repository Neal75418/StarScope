/**
 * React Query hook 用於取得 repos 列表。
 */

import { useQuery } from "@tanstack/react-query";
import { getRepos } from "../api/client";
import { queryKeys } from "../lib/react-query";
import type { RepoWithSignals } from "../api/types";

interface UseReposQueryOptions {
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
