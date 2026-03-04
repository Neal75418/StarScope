/**
 * 搜尋歷史管理，使用 localStorage 持久化。
 * 最多保留 10 筆，新的在前，重複的移到最前。
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { logger } from "../utils/logger";

const STORAGE_KEY = "starscope_search_history";
const MAX_HISTORY = 10;

function loadHistory(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      if (Array.isArray(parsed)) {
        return parsed.filter((s) => typeof s === "string" && s.trim()).slice(0, MAX_HISTORY);
      }
    }
  } catch (err) {
    logger.warn("[SearchHistory] 載入搜尋歷史失敗:", err);
  }
  return [];
}

function saveHistory(history: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (err) {
    logger.warn("[SearchHistory] 儲存搜尋歷史失敗:", err);
  }
}

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>(loadHistory);
  const isInitialMount = useRef(true);

  // 同步到 localStorage（跳過初始掛載，避免重複寫入剛載入的資料）
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    saveHistory(history);
  }, [history]);

  const addToHistory = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setHistory((prev) => {
      // 移除重複
      const filtered = prev.filter((h) => h !== trimmed);
      // 新的在前，限制數量
      return [trimmed, ...filtered].slice(0, MAX_HISTORY);
    });
  }, []);

  const removeFromHistory = useCallback((query: string) => {
    setHistory((prev) => prev.filter((h) => h !== query));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return { history, addToHistory, removeFromHistory, clearHistory };
}
