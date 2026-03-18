/**
 * 檢視模式管理：Grid / List，使用 localStorage 持久化。
 * 可接受自訂 storageKey，讓多個頁面各自保存偏好。
 */

import { useState, useCallback } from "react";
import { STORAGE_KEYS } from "../constants/storage";

export type ViewMode = "list" | "grid";

function loadViewMode(storageKey: string): ViewMode {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === "grid" || stored === "list") return stored;
  } catch {
    // ignore
  }
  return "list";
}

export function useViewMode(storageKey: string = STORAGE_KEYS.VIEW_MODE) {
  const [viewMode, setViewModeState] = useState<ViewMode>(() => loadViewMode(storageKey));

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      setViewModeState(mode);
      try {
        localStorage.setItem(storageKey, mode);
      } catch {
        // ignore
      }
    },
    [storageKey]
  );

  return { viewMode, setViewMode };
}
