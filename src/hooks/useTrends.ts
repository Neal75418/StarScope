/**
 * 趨勢 Repo 資料的取得與排序。
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { API_ENDPOINT } from "../config";
import { useI18n } from "../i18n";
import { TRENDS_DEFAULT_LIMIT } from "../constants/api";

export type SortOption = "velocity" | "stars_delta_7d" | "stars_delta_30d" | "acceleration";

export interface TrendingRepo {
  id: number;
  owner: string;
  name: string;
  full_name: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number | null;
  stars_delta_7d: number | null;
  stars_delta_30d: number | null;
  velocity: number | null;
  acceleration: number | null;
  trend: number | null;
  rank: number;
}

interface TrendsResponse {
  repos: TrendingRepo[];
  total: number;
  sort_by: string;
}

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
        const params = new URLSearchParams({
          sort_by: sort,
          limit: String(TRENDS_DEFAULT_LIMIT),
        });
        if (language) params.set("language", language);
        if (minStars !== null) params.set("min_stars", String(minStars));

        const res = await fetch(`${API_ENDPOINT}/trends/?${params}`);
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const data: TrendsResponse = await res.json();
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
