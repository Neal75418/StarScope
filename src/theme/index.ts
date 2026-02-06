/**
 * StarScope 主題系統。
 * 支援深色與淺色主題。
 */

import { createContext, useContext } from "react";

export type Theme = "dark" | "light";

// 儲存主題偏好的 localStorage key
const THEME_STORAGE_KEY = "starscope-theme";

// 從 localStorage 或系統偏好取得初始主題
export function getInitialTheme(): Theme {
  // 優先檢查 localStorage
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
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
  localStorage.setItem(THEME_STORAGE_KEY, theme);
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

// 使用主題的 Hook
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
