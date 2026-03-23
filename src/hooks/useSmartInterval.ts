/**
 * 智慧輪詢間隔工具。
 * 提供 visibility-aware + online-aware 的 refetchInterval 函式，
 * 統一所有背景輪詢的暫停/恢復行為。
 *
 * 使用方式：
 * - React Query: `refetchInterval: useSmartInterval(60_000)`
 */

import { useCallback, useRef } from "react";
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
