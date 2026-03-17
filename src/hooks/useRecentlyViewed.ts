/**
 * 最近檢視的 repo 管理，使用 localStorage 持久化。
 * 最多保留 20 筆，新的在前，重複的移到最前。
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { logger } from "../utils/logger";
import { STORAGE_KEYS } from "../constants/storage";

const MAX_RECENTLY_VIEWED = 20;

export interface RecentlyViewedRepo {
  id: number;
  full_name: string;
  owner: string;
  name: string;
  language: string | null;
  stars: number;
  owner_avatar_url: string | null;
}

function loadRecentlyViewed(): RecentlyViewedRepo[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.RECENTLY_VIEWED);
    if (stored) {
      const parsed = JSON.parse(stored) as RecentlyViewedRepo[];
      if (Array.isArray(parsed)) {
        return parsed.slice(0, MAX_RECENTLY_VIEWED);
      }
    }
  } catch (err) {
    logger.warn("[RecentlyViewed] 載入失敗:", err);
  }
  return [];
}

function saveRecentlyViewed(repos: RecentlyViewedRepo[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.RECENTLY_VIEWED, JSON.stringify(repos));
  } catch (err) {
    logger.warn("[RecentlyViewed] 儲存失敗:", err);
  }
}

export function useRecentlyViewed() {
  const [recentRepos, setRecentRepos] = useState<RecentlyViewedRepo[]>(loadRecentlyViewed);
  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    saveRecentlyViewed(recentRepos);
  }, [recentRepos]);

  const addToRecentlyViewed = useCallback((repo: RecentlyViewedRepo) => {
    setRecentRepos((prev) => {
      const filtered = prev.filter((r) => r.full_name !== repo.full_name);
      return [repo, ...filtered].slice(0, MAX_RECENTLY_VIEWED);
    });
  }, []);

  const clearRecentlyViewed = useCallback(() => {
    setRecentRepos([]);
  }, []);

  return { recentRepos, addToRecentlyViewed, clearRecentlyViewed };
}
