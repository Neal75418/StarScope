/**
 * Theme system for StarScope
 * Supports: Dark and Light themes
 */

import { createContext, useContext } from "react";

export type Theme = "dark" | "light";

// Storage key for persisting theme preference
const THEME_STORAGE_KEY = "starscope-theme";

// Get initial theme from localStorage or system preference
export function getInitialTheme(): Theme {
  // Check localStorage first
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "dark" || stored === "light") {
    return stored;
  }

  // Fall back to system preference
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }

  return "dark";
}

// Save theme preference
export function saveTheme(theme: Theme): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

// Apply theme to document
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

// Context for theme state
interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextType | null>(null);

// Hook to use theme
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
