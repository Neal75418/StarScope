/**
 * StarScope 主題系統。
 * 支援深色與淺色主題。
 */

import { createContext } from "react";
import { STORAGE_KEYS } from "../constants/storage";

export type Theme = "dark" | "light";

// 從 localStorage 或系統偏好取得初始主題
export function getInitialTheme(): Theme {
  // 優先檢查 localStorage
  const stored = localStorage.getItem(STORAGE_KEYS.THEME);
  if (stored === "dark" || stored === "light") {
    return stored;
  }

  // 退回使用系統偏好
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }

  return "dark";
}

// 儲存主題偏好
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
  } catch {
    // QuotaExceededError — 靜默忽略，主題偏好不會持久化
  }
}

// 將主題套用至 document
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

// 主題狀態的 Context
interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextType | null>(null);
