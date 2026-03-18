/**
 * NavigationContext：跨頁導航 + 傳遞初始狀態（如 preselectedIds）。
 */

import { createContext, useContext, useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Page } from "../types/navigation";

export interface NavigationState {
  /** 目標頁面要用的初始狀態 */
  [key: string]: unknown;
}

interface NavigationContextValue {
  /** 導航到指定頁面並附帶可選的狀態 */
  navigateTo: (page: Page, state?: NavigationState) => void;
  /** 當前導航附帶的狀態（消費後清空） */
  navigationState: NavigationState | null;
  /** 消費掉 navigationState（讀取一次後呼叫以清空） */
  consumeNavigationState: () => NavigationState | null;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

interface NavigationProviderProps {
  children: ReactNode;
  onPageChange: (page: Page) => void;
}

export function NavigationProvider({ children, onPageChange }: NavigationProviderProps) {
  const [navState, setNavState] = useState<NavigationState | null>(null);
  const navStateRef = useRef<NavigationState | null>(null);
  navStateRef.current = navState;

  const navigateTo = useCallback(
    (page: Page, state?: NavigationState) => {
      setNavState(state ?? null);
      onPageChange(page);
    },
    [onPageChange]
  );

  const consumeNavigationState = useCallback(() => {
    const current = navStateRef.current;
    setNavState(null);
    return current;
  }, []);

  return (
    <NavigationContext.Provider
      value={{ navigateTo, navigationState: navState, consumeNavigationState }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider");
  return ctx;
}
