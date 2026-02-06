/**
 * 已儲存篩選條件的管理，使用 localStorage 持久化。
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { SearchFilters } from "../api/client";

export interface SavedFilter {
  id: string;
  name: string;
  createdAt: string;
  query: string;
  period?: string;
  filters: SearchFilters;
}

const STORAGE_KEY = "starscope_saved_filters";
const MAX_SAVED_FILTERS = 20;

/**
 * 產生唯一的篩選條件 ID。
 */
function generateId(): string {
  return `filter-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 從 localStorage 載入已儲存篩選條件。
 */
function loadSavedFilters(): SavedFilter[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as SavedFilter[];
      // 驗證後回傳
      if (Array.isArray(parsed)) {
        return parsed.filter((f) => f && f.id && f.name);
      }
    }
  } catch (err) {
    console.warn("載入已儲存篩選條件失敗:", err);
  }
  return [];
}

/**
 * 將篩選條件儲存至 localStorage。
 */
function saveSavedFilters(filters: SavedFilter[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch (err) {
    console.warn("篩選條件儲存失敗:", err);
  }
}

export function useSavedFilters() {
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const mountedRef = useRef(true);
  const savedFiltersRef = useRef<SavedFilter[]>([]);

  // 掛載時從 localStorage 載入
  useEffect(() => {
    const loaded = loadSavedFilters();
    if (mountedRef.current) {
      setSavedFilters(loaded);
      setIsLoaded(true);
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 篩選條件變更時存入 localStorage（初次載入除外）
  useEffect(() => {
    if (isLoaded) {
      saveSavedFilters(savedFilters);
    }
    // 同步 ref 避免閉包取到舊值
    savedFiltersRef.current = savedFilters;
  }, [savedFilters, isLoaded]);

  const saveFilter = useCallback(
    (
      name: string,
      query: string,
      period: string | undefined,
      filters: SearchFilters
    ): SavedFilter => {
      // 在 setter 外產生 ID 與時間戳以便回傳
      const id = generateId();
      const createdAt = new Date().toISOString();
      const trimmedName = name.trim();

      // 透過 ref 取得目前數量以產生預設名稱
      const currentCount = savedFiltersRef.current.length;
      const filterName = trimmedName || `篩選條件 ${currentCount + 1}`;

      const newFilter: SavedFilter = {
        id,
        name: filterName,
        createdAt,
        query,
        period,
        filters,
      };

      setSavedFilters((prev) => {
        // 超過上限時移除最舊的
        const updated = [newFilter, ...prev];
        if (updated.length > MAX_SAVED_FILTERS) {
          return updated.slice(0, MAX_SAVED_FILTERS);
        }
        return updated;
      });

      return newFilter;
    },
    []
  );

  const deleteFilter = useCallback((filterId: string) => {
    setSavedFilters((prev) => prev.filter((f) => f.id !== filterId));
  }, []);

  const renameFilter = useCallback((filterId: string, newName: string) => {
    setSavedFilters((prev) =>
      prev.map((f) => (f.id === filterId ? { ...f, name: newName.trim() || f.name } : f))
    );
  }, []);

  const clearAllFilters = useCallback(() => {
    setSavedFilters([]);
  }, []);

  const hasFilters = savedFilters.length > 0;

  return {
    savedFilters,
    saveFilter,
    deleteFilter,
    renameFilter,
    clearAllFilters,
    hasFilters,
    isLoaded,
  };
}
