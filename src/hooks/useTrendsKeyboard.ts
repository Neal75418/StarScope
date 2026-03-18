/**
 * Trends 鍵盤快捷鍵：
 * - `r` → 重整趨勢資料
 * - `g` → 切換 Grid / List 視圖
 * - `1`~`6` → 切換排序指標
 * - `Escape` → 收合展開列 / 退出選取模式
 */

import { useEffect } from "react";
import type { SortOption } from "./useTrends";

const SORT_KEYS_MAP: Record<string, SortOption> = {
  "1": "velocity",
  "2": "stars_delta_7d",
  "3": "stars_delta_30d",
  "4": "acceleration",
  "5": "forks_delta_7d",
  "6": "issues_delta_7d",
};

interface UseTrendsKeyboardOptions {
  onRefresh: () => void;
  onToggleViewMode: () => void;
  onSetSortBy: (s: SortOption) => void;
  onEscape: () => void;
  enabled?: boolean;
}

export function useTrendsKeyboard({
  onRefresh,
  onToggleViewMode,
  onSetSortBy,
  onEscape,
  enabled = true,
}: UseTrendsKeyboardOptions): void {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      // 忽略輸入框內的按鍵
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      // 忽略 modifier keys
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const sortOption = SORT_KEYS_MAP[e.key];
      if (sortOption) {
        e.preventDefault();
        onSetSortBy(sortOption);
        return;
      }

      switch (e.key) {
        case "r":
          e.preventDefault();
          onRefresh();
          break;
        case "g":
          e.preventDefault();
          onToggleViewMode();
          break;
        case "Escape":
          e.preventDefault();
          onEscape();
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onRefresh, onToggleViewMode, onSetSortBy, onEscape, enabled]);
}
