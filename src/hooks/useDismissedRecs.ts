/**
 * 被 dismiss 的推薦管理，使用 localStorage 持久化。
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { logger } from "../utils/logger";
import { STORAGE_KEYS } from "../constants/storage";

function loadDismissed(): Set<number> {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.DISMISSED_RECS);
    if (stored) {
      const parsed = JSON.parse(stored) as number[];
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((id) => typeof id === "number"));
      }
    }
  } catch (err) {
    logger.warn("[DismissedRecs] 載入 dismissed recs 失敗:", err);
  }
  return new Set();
}

function saveDismissed(ids: Set<number>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.DISMISSED_RECS, JSON.stringify([...ids]));
  } catch (err) {
    logger.warn("[DismissedRecs] 儲存 dismissed recs 失敗:", err);
  }
}

export function useDismissedRecs() {
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(loadDismissed);
  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    saveDismissed(dismissedIds);
  }, [dismissedIds]);

  const dismiss = useCallback((repoId: number) => {
    setDismissedIds((prev) => new Set(prev).add(repoId));
  }, []);

  return { dismissedIds, dismiss };
}
