/**
 * 通知已讀狀態的 localStorage 持久化管理。
 */

import { useRef, useCallback } from "react";
import { logger } from "../utils/logger";
import { STORAGE_KEYS } from "../constants/storage";

/**
 * 從 localStorage 載入已讀通知 ID。
 */
function loadReadIds(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_READ);
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      return new Set(parsed);
    }
  } catch (err) {
    logger.warn("[NotificationStorage] 載入已讀通知 ID 失敗:", err);
  }
  return new Set();
}

/**
 * 將已讀通知 ID 儲存至 localStorage。
 */
function saveReadIds(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS_READ, JSON.stringify([...ids]));
  } catch (err) {
    logger.warn("[NotificationStorage] 儲存已讀通知 ID 失敗:", err);
  }
}

export function useNotificationStorage() {
  const readIdsRef = useRef<Set<string>>(loadReadIds());

  const markIdAsRead = useCallback((id: string) => {
    readIdsRef.current.add(id);
    saveReadIds(readIdsRef.current);
  }, []);

  const markIdsAsRead = useCallback((ids: string[]) => {
    ids.forEach((id) => readIdsRef.current.add(id));
    saveReadIds(readIdsRef.current);
  }, []);

  return {
    readIdsRef,
    markIdAsRead,
    markIdsAsRead,
  };
}
