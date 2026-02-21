/**
 * React Query 配置
 *
 * 提供統一的查詢快取、重試邏輯和資料同步策略。
 */

import { QueryClient } from "@tanstack/react-query";

/**
 * 建立 QueryClient 實例
 *
 * 配置說明：
 * - staleTime: 5 分鐘內資料視為新鮮，不會觸發背景重新取得
 * - gcTime: 30 分鐘後清除未使用的快取
 * - refetchOnWindowFocus: 關閉視窗重新聚焦時的自動重新取得（避免不必要的請求）
 * - retry: 失敗時重試 1 次（避免過度重試）
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 快取策略
      staleTime: 1000 * 60 * 5, // 5 分鐘
      gcTime: 1000 * 60 * 30, // 30 分鐘（原 cacheTime）

      // 自動重新取得
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,

      // 錯誤處理
      retry: 1,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: 0, // Mutation 不重試（避免重複提交）
    },
  },
});

/**
 * 查詢 key 工廠
 *
 * 提供型別安全的查詢 key 生成器，避免魔術字串。
 */
export const queryKeys = {
  // Repos
  repos: {
    all: ["repos"] as const,
    lists: () => [...queryKeys.repos.all, "list"] as const,
    list: (filters: { page?: number; perPage?: number } = {}) =>
      [...queryKeys.repos.lists(), filters] as const,
    details: () => [...queryKeys.repos.all, "detail"] as const,
    detail: (id: number) => [...queryKeys.repos.details(), id] as const,
  },

  // Early Signals
  signals: {
    all: ["signals"] as const,
    lists: () => [...queryKeys.signals.all, "list"] as const,
    list: (filters: { repoId?: number } = {}) => [...queryKeys.signals.lists(), filters] as const,
    batch: (repoIds: number[]) => [...queryKeys.signals.all, "batch", repoIds] as const,
  },

  // Context Badges
  contextBadges: {
    all: ["contextBadges"] as const,
    batch: (repoIds: number[]) => [...queryKeys.contextBadges.all, "batch", repoIds] as const,
  },

  // Discovery
  discovery: {
    all: ["discovery"] as const,
    categories: () => [...queryKeys.discovery.all, "categories"] as const,
    trending: () => [...queryKeys.discovery.all, "trending"] as const,
  },

  // GitHub Auth
  githubAuth: {
    status: ["githubAuth", "status"] as const,
    rateLimit: ["githubAuth", "rateLimit"] as const,
  },

  // Dashboard
  dashboard: {
    stats: ["dashboard", "stats"] as const,
    health: ["dashboard", "health"] as const,
  },
} as const;
