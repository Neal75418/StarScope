/**
 * 輪詢／計時間隔工具。
 *
 * 兩者都在頁面隱藏時暫停，差別在「暫停的條件」與「回傳的東西」：
 * - `useSmartInterval`：給 React Query 的 `refetchInterval` 用，隱藏**或離線**時暫停。
 * - `useVisibleInterval`：給顯示用計時器（相對時間、倒數）用，只看可見性。
 *   這類計時器與網路無關，離線時倒數仍該繼續走。
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

  return useCallback(() => {
    // 頁面不可見時暫停
    if (typeof document !== "undefined" && document.hidden) {
      return false;
    }
    // 離線時暫停（isOnline 在 deps 中，上線時產生新 reference 通知 React Query 重啟 timer）
    if (!isOnline) {
      return false;
    }
    return intervalMs;
  }, [intervalMs, isOnline]);
}

/**
 * 以固定間隔執行 callback，頁面隱藏時暫停、恢復可見時**立即補跑一次**再重啟計時。
 *
 * 補跑是必要的：隱藏期間畫面上的相對時間／倒數已經過期，
 * 若只是重啟計時，使用者會先看到一個舊值直到下一次 tick。
 *
 * `delayMs` 傳 `false` 代表停用（與 React Query `refetchInterval` 的慣例一致）。
 * callback 存在 ref 裡，所以每次 render 換新的函式 reference 不會重啟計時器。
 */
export function useVisibleInterval(callback: () => void, delayMs: number | false): void {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delayMs === false) return;

    let id: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      if (id === undefined) {
        id = setInterval(() => savedCallback.current(), delayMs);
      }
    };
    const stop = () => {
      if (id !== undefined) {
        clearInterval(id);
        id = undefined;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        savedCallback.current();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [delayMs]);
}
