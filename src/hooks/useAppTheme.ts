/**
 * Custom hook for theme management.
 * Encapsulates theme state, persistence, and DOM updates.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Theme, getInitialTheme, saveTheme, applyTheme } from "../theme";

export interface UseAppThemeReturn {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export function useAppTheme(): UseAppThemeReturn {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    saveTheme(newTheme);
    applyTheme(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const newTheme = current === "dark" ? "light" : "dark";
      saveTheme(newTheme);
      applyTheme(newTheme);
      return newTheme;
    });
  }, []);

  // Apply theme on mount
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Memoize return object to prevent unnecessary re-renders
  return useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme]
  );
}
