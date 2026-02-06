/**
 * 主題狀態管理、持久化與 DOM 更新。
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

  // 掛載時套用主題
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // 記憶化回傳物件，避免不必要的 re-render
  return useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
}
