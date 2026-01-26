import { useRef, useCallback } from "react";

const STORAGE_KEY = "starscope_notifications_read";

/**
 * Load read notification IDs from localStorage.
 */
function loadReadIds(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      return new Set(parsed);
    }
  } catch (err) {
    console.warn("Failed to load notification read IDs:", err);
  }
  return new Set();
}

/**
 * Save read notification IDs to localStorage.
 */
function saveReadIds(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch (err) {
    console.warn("Failed to save notification read IDs:", err);
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
