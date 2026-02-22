/**
 * 趨勢 Repo 資料的取得與排序。
 * 使用 React Query 管理資料快取與請求去重。
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { TRENDS_DEFAULT_LIMIT } from "../constants/api";
import { getTrends } from "../api/client";
import { queryKeys } from "../lib/react-query";

export type { TrendingRepo } from "../api/client";
export type SortOption = "velocity" | "stars_delta_7d" | "stars_delta_30d" | "acceleration";

export function useTrends() {
  const [sortBy, setSortBy] = useState<SortOption>("velocity");
  const [languageFilter, setLanguageFilter] = useState<string>("");
  const [minStarsFilter, setMinStarsFilter] = useState<number | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.trends.list({
      sortBy,
      language: languageFilter || undefined,
      minStars: minStarsFilter,
    }),
    queryFn: () =>
      getTrends({
        sortBy,
        limit: TRENDS_DEFAULT_LIMIT,
        language: languageFilter || undefined,
        minStars: minStarsFilter ?? undefined,
      }),
  });

  const trends = data?.repos ?? [];

  // 從目前結果動態提取語言選項
  const availableLanguages = useMemo(() => {
    const langs = new Set<string>();
    for (const repo of trends) {
      if (repo.language) langs.add(repo.language);
    }
    return [...langs].sort();
  }, [trends]);

  return {
    trends,
    loading: isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    sortBy,
    setSortBy,
    languageFilter,
    setLanguageFilter,
    minStarsFilter,
    setMinStarsFilter,
    availableLanguages,
    retry: useCallback(() => void refetch(), [refetch]),
  };
}
