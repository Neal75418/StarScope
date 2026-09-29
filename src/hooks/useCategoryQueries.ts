/**
 * 分類樹與分類成員的查詢。
 *
 * key 都在 queryKeys.repos 底下：分類的數量與成員不算封存的 repo，追蹤名單一變就要跟著重讀，
 * 重取 repo 清單的入口（invalidateTrackedRepos）會一起帶到。側欄、批次加入分類的選單與
 * Dashboard 的分類摘要共用同一份分類樹。
 */

import { skipToken, useQuery } from "@tanstack/react-query";
import { getCategoryRepos, getCategoryTree } from "../api/client";
import { queryKeys } from "../lib/react-query";

export function useCategoryTreeQuery() {
  return useQuery({
    queryKey: queryKeys.repos.categoryTree(),
    queryFn: ({ signal }) => getCategoryTree(signal),
    // 背景的星標同步不會通知前端：每次打開 Watchlist 或 Dashboard 都重讀，才不會停在舊數量
    refetchOnMount: "always",
    // apiCall 已經會重試網路錯誤與 5xx，這裡再重試只會讓失敗晚一秒才出現
    retry: false,
  });
}

/** 選定分類的成員 repo id；沒選分類（null）時不發請求。 */
export function useCategoryMembersQuery(categoryId: number | null) {
  return useQuery({
    queryKey: queryKeys.repos.categoryMembers(categoryId),
    queryFn:
      categoryId === null
        ? skipToken
        : async ({ signal }) =>
            (await getCategoryRepos(categoryId, signal)).repos.map((repo) => repo.id),
    retry: false,
  });
}
