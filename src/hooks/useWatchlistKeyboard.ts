/**
 * Watchlist 鍵盤快捷鍵：
 * - `/` → 聚焦搜尋框
 * - `r` → 刷新全部
 * - `a` → 開啟新增 dialog
 */

import { useEffect, type RefObject } from "react";

interface UseWatchlistKeyboardOptions {
  searchInputRef: RefObject<HTMLInputElement | null>;
  onRefreshAll: () => void;
  onAddRepo: () => void;
  enabled?: boolean;
}

export function useWatchlistKeyboard({
  searchInputRef,
  onRefreshAll,
  onAddRepo,
  enabled = true,
}: UseWatchlistKeyboardOptions): void {
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

      switch (e.key) {
        case "/":
          e.preventDefault();
          searchInputRef.current?.focus();
          break;
        case "r":
          e.preventDefault();
          onRefreshAll();
          break;
        case "a":
          e.preventDefault();
          onAddRepo();
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [searchInputRef, onRefreshAll, onAddRepo, enabled]);
}
