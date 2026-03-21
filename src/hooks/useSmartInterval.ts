/**
 * 智慧輪詢間隔工具。
 * 提供 visibility-aware + online-aware 的 refetchInterval 函式，
 * 統一所有背景輪詢的暫停/恢復行為。
 *
 * 使用方式：
 * - React Query: `refetchInterval: useSmartInterval(60_000)`
 * - 原生 setInterval: `useSmartIntervalCallback(callback, intervalMs)`
 */

import { useCallback, useEffect, useRef } from "react";
import { useOnlineStatus } from "./useOnlineStatus";

/**
 * 回傳 visibility + online aware 的 refetchInterval 函式。
 * 頁面隱藏或離線時暫停輪詢。
 * 用於 React Query 的 refetchInterval 參數。
 */
export function useSmartInterval(intervalMs: number): () => number | false {
  const isOnline = useOnlineStatus();
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;

  return useCallback(() => {
    // 頁面不可見時暫停
    if (typeof document !== "undefined" && document.hidden) {
      return false;
    }
    // 離線時暫停
    if (!isOnlineRef.current) {
      return false;
    }
    return intervalMs;
  }, [intervalMs]);
}

/**
 * 智慧 setInterval：visibility + online aware。
 * 頁面隱藏或離線時自動暫停，恢復時繼續。
 * 用於非 React Query 的原生輪詢場景（如 OAuth Device Flow）。
 */
export function useSmartIntervalCallback(callback: (() => void) | null, intervalMs: number): void {
  const isOnline = useOnlineStatus();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!callbackRef.current || intervalMs <= 0) return;

    const shouldRun = () => {
      if (typeof document !== "undefined" && document.hidden) return false;
      if (!isOnline) return false;
      return true;
    };

    const tick = () => {
      if (shouldRun() && callbackRef.current) {
        callbackRef.current();
      }
    };

    intervalRef.current = window.setInterval(tick, intervalMs);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, [intervalMs, isOnline]);
}
