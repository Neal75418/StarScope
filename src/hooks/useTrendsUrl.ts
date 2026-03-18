/**
 * Trends URL 同步：將排序、語言篩選、最低星數序列化到 URL hash。
 * Hash 格式：#t:sort=velocity&lang=Python&stars=1000
 */

import { useEffect, useRef, useState } from "react";
import type { SortOption } from "./useTrends";

const HASH_PREFIX = "t:";

export interface TrendsUrlState {
  sortBy: SortOption;
  language: string;
  minStars: number | null;
}

interface UseTrendsUrlOptions {
  sortBy: SortOption;
  language: string;
  minStars: number | null;
  onRestoreState: (state: TrendsUrlState) => void;
}

const VALID_SORT_KEYS: Set<string> = new Set([
  "velocity",
  "stars_delta_7d",
  "stars_delta_30d",
  "acceleration",
  "forks_delta_7d",
  "issues_delta_7d",
]);

function serializeToHash(state: TrendsUrlState): string {
  const params = new URLSearchParams();
  if (state.sortBy !== "velocity") params.set("sort", state.sortBy);
  if (state.language) params.set("lang", state.language);
  if (state.minStars != null) params.set("stars", String(state.minStars));

  const str = params.toString();
  return str ? `#${HASH_PREFIX}${str}` : "";
}

function deserializeFromHash(hash: string): TrendsUrlState | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(HASH_PREFIX)) return null;

  const paramStr = raw.slice(HASH_PREFIX.length);
  if (!paramStr) return null;

  const params = new URLSearchParams(paramStr);
  if (params.size === 0) return null;

  const sortRaw = params.get("sort") ?? "velocity";
  const sortBy: SortOption = VALID_SORT_KEYS.has(sortRaw) ? (sortRaw as SortOption) : "velocity";

  const language = params.get("lang") ?? "";

  const starsRaw = params.get("stars");
  const minStars = starsRaw ? Number(starsRaw) : null;
  if (starsRaw && (isNaN(minStars as number) || (minStars as number) < 0)) return null;

  return { sortBy, language, minStars };
}

export function useTrendsUrl({ sortBy, language, minStars, onRestoreState }: UseTrendsUrlOptions) {
  const isSyncingRef = useRef(false);
  const [hasUrlParams, setHasUrlParams] = useState(false);
  const initializedRef = useRef(false);
  const restoreRef = useRef(onRestoreState);
  restoreRef.current = onRestoreState;

  // 初始化：mount 時如果 hash 有 trends 參數 → 恢復狀態
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const restored = deserializeFromHash(window.location.hash);
    if (restored) {
      setHasUrlParams(true);
      isSyncingRef.current = true;
      restoreRef.current(restored);
      queueMicrotask(() => {
        isSyncingRef.current = false;
      });
    }
  }, []);

  // State → URL：狀態變更時更新 hash
  useEffect(() => {
    if (isSyncingRef.current) return;

    const hasState = sortBy !== "velocity" || language || minStars != null;
    if (!hasState) {
      if (window.location.hash.startsWith(`#${HASH_PREFIX}`)) {
        window.history.replaceState(null, "", window.location.pathname);
      }
      return;
    }

    const newHash = serializeToHash({ sortBy, language, minStars });
    const currentHash = window.location.hash || "";
    if (newHash !== currentHash) {
      window.history.replaceState(null, "", newHash || window.location.pathname);
    }
  }, [sortBy, language, minStars]);

  // hashchange 事件：瀏覽器前進/後退時恢復
  useEffect(() => {
    function handleHashChange() {
      if (isSyncingRef.current) return;

      const restored = deserializeFromHash(window.location.hash);
      if (restored) {
        isSyncingRef.current = true;
        restoreRef.current(restored);
        requestAnimationFrame(() => {
          isSyncingRef.current = false;
        });
      }
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return { hasUrlParams };
}

// 匯出 helper 以便測試
export { serializeToHash as _serializeToHash, deserializeFromHash as _deserializeFromHash };
