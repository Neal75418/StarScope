/**
 * 搜尋與探索功能的輔助函式。
 */

import { TrendingPeriod } from "../components/discovery";
import { searchRepos, SearchFilters, DiscoveryRepo, ApiError } from "../api/client";

export interface SearchResult {
  repos: DiscoveryRepo[];
  totalCount: number;
  hasMore: boolean;
  error?: string;
}

export async function fetchSearchResults(
  query: string,
  filters: SearchFilters,
  page: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any,
  signal?: AbortSignal
): Promise<SearchResult> {
  try {
    signal?.throwIfAborted();
    const result = await searchRepos(query, filters, page, signal);
    signal?.throwIfAborted();
    return {
      repos: result.repos,
      totalCount: result.total_count,
      hasMore: result.has_more,
    };
  } catch (err) {
    // 重新拋出 abort 錯誤，讓呼叫端能區分取消操作
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    let errorMessage = t.discovery.error.generic;
    if (err instanceof ApiError && err.status === 429) {
      errorMessage = t.discovery.error.rateLimit;
    }
    return {
      repos: [],
      totalCount: 0,
      hasMore: false,
      error: errorMessage,
    };
  }
}

// 起始日期工具
export function getStartDateForPeriod(period: TrendingPeriod): string {
  const now = new Date();
  switch (period) {
    case "daily":
      now.setDate(now.getDate() - 1);
      break;
    case "weekly":
      now.setDate(now.getDate() - 7);
      break;
    case "monthly":
      now.setDate(now.getDate() - 30);
      break;
  }
  return now.toISOString().split("T")[0];
}

export function getMinStarsForPeriod(period: TrendingPeriod): number {
  switch (period) {
    case "daily":
      return 10;
    case "weekly":
      return 50;
    case "monthly":
      return 100;
  }
}

// 組合查詢邏輯
export function buildCombinedQuery(
  keyword: string,
  period: TrendingPeriod | undefined,
  language: string | undefined
): string {
  const parts: string[] = [];

  if (keyword.trim()) {
    parts.push(keyword.trim());
  }

  if (period) {
    const dateStr = getStartDateForPeriod(period);
    const minStars = getMinStarsForPeriod(period);
    parts.push(`created:>${dateStr}`);
    parts.push(`stars:>=${minStars}`);
  }

  if (language) {
    parts.push(`language:${language}`);
  }

  return parts.join(" ");
}
