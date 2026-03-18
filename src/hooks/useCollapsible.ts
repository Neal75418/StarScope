/**
 * 通用收合狀態 hook，持久化到 localStorage。
 */

import { useState, useCallback } from "react";

export function useCollapsible(storageKey: string, defaultCollapsed = false) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "true" || stored === "false") return stored === "true";
    } catch {
      // ignore
    }
    return defaultCollapsed;
  });

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, [storageKey]);

  return { collapsed, toggle };
}
