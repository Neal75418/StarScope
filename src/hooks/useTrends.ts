/**
 * 趨勢 Repo 資料的取得與排序。
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useI18n } from "../i18n";
import { TRENDS_DEFAULT_LIMIT } from "../constants/api";
import { getTrends, TrendingRepo } from "../api/client";

export type { TrendingRepo } from "../api/client";
export type SortOption = "velocity" | "stars_delta_7d" | "stars_delta_30d" | "acceleration";

export function useTrends() {
  const { t } = useI18n();
  const [trends, setTrends] = useState<TrendingRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("velocity");
  const [languageFilter, setLanguageFilter] = useState<string>("");
  const [minStarsFilter, setMinStarsFilter] = useState<number | null>(null);

  // 避免 StrictMode 重複請求
  const isFetchingRef = useRef(false);

  const fetchTrends = useCallback(
    async (sort: SortOption, language: string, minStars: number | null) => {
      // 避免重複請求（防止 StrictMode 雙重觸發）
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;

      setLoading(true);
      setError(null);

      try {
        const data = await getTrends({
          sortBy: sort,
          limit: TRENDS_DEFAULT_LIMIT,
          language: language || undefined,
          minStars: minStars ?? undefined,
        });
        setTrends(data.repos);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.trends.loadingError);
      } finally {
        setLoading(false);
        isFetchingRef.current = false;
      }
    },
    [t.trends.loadingError]
  );

  useEffect(() => {
    void fetchTrends(sortBy, languageFilter, minStarsFilter);
  }, [sortBy, languageFilter, minStarsFilter, fetchTrends]);

  const retry = useCallback(() => {
    void fetchTrends(sortBy, languageFilter, minStarsFilter);
  }, [fetchTrends, sortBy, languageFilter, minStarsFilter]);

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
    loading,
    error,
    sortBy,
    setSortBy,
    languageFilter,
    setLanguageFilter,
    minStarsFilter,
    setMinStarsFilter,
    availableLanguages,
    retry,
  };
}
