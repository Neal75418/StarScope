/**
 * 檢視模式管理：Grid / List，使用 localStorage 持久化。
 */

import { useState, useCallback } from "react";
import { STORAGE_KEYS } from "../constants/storage";

export type ViewMode = "list" | "grid";

function loadViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.VIEW_MODE);
    if (stored === "grid" || stored === "list") return stored;
  } catch {
    // ignore
  }
  return "list";
}

export function useViewMode() {
  const [viewMode, setViewModeState] = useState<ViewMode>(loadViewMode);

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    try {
      localStorage.setItem(STORAGE_KEYS.VIEW_MODE, mode);
    } catch {
      // ignore
    }
  }, []);

  return { viewMode, setViewMode };
}
