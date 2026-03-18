/**
 * 篩選條件 URL 同步：將 Discovery 頁面的搜尋狀態序列化到 URL hash。
 * 支援：
 * - 頁面重整後恢復狀態
 * - 複製分享 URL
 * - 瀏覽器前進/後退
 */

import { useEffect, useRef, useState } from "react";
import type { SearchFilters } from "../api/client";
import type { TrendingPeriod } from "../components/discovery";

interface UseDiscoveryUrlOptions {
  keyword: string;
  period: TrendingPeriod | undefined;
  filters: SearchFilters;
  hasSearched: boolean;
  onRestoreState: (state: {
    keyword: string;
    period: TrendingPeriod | undefined;
    filters: SearchFilters;
  }) => void;
}

/** 將狀態序列化為 URL hash string */
function serializeToHash(
  keyword: string,
  period: TrendingPeriod | undefined,
  filters: SearchFilters
): string {
  const params = new URLSearchParams();
  if (keyword) params.set("q", keyword);
  if (period) params.set("period", period);
  if (filters.language) params.set("lang", filters.language);
  if (filters.topic) params.set("topic", filters.topic);
  if (filters.minStars && filters.minStars > 0) params.set("minStars", String(filters.minStars));
  if (filters.maxStars && filters.maxStars > 0) params.set("maxStars", String(filters.maxStars));
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.order) params.set("order", filters.order);
  if (filters.license) params.set("license", filters.license);
  if (filters.hideArchived) params.set("hideArchived", "true");

  const str = params.toString();
  return str ? `#${str}` : "";
}

/** 從 URL hash 解析狀態 */
function deserializeFromHash(hash: string): {
  keyword: string;
  period: TrendingPeriod | undefined;
  filters: SearchFilters;
} | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  // 至少要有一個有效參數才算有 URL state
  if (params.size === 0) return null;

  const keyword = params.get("q") ?? "";
  const periodRaw = params.get("period");
  const period: TrendingPeriod | undefined =
    periodRaw === "daily" || periodRaw === "weekly" || periodRaw === "monthly"
      ? periodRaw
      : undefined;

  const minStarsRaw = params.get("minStars");
  const maxStarsRaw = params.get("maxStars");
  const sortRaw = params.get("sort");
  const orderRaw = params.get("order");

  const filters: SearchFilters = {};
  const langVal = params.get("lang");
  if (langVal) filters.language = langVal;
  const topicVal = params.get("topic");
  if (topicVal) filters.topic = topicVal;
  if (minStarsRaw) {
    const n = Number(minStarsRaw);
    if (!isNaN(n) && n > 0) filters.minStars = n;
  }
  if (maxStarsRaw) {
    const n = Number(maxStarsRaw);
    if (!isNaN(n) && n > 0) filters.maxStars = n;
  }
  if (sortRaw === "stars" || sortRaw === "forks" || sortRaw === "updated") {
    filters.sort = sortRaw;
  }
  if (orderRaw === "asc" || orderRaw === "desc") {
    filters.order = orderRaw;
  }
  const licenseVal = params.get("license");
  if (licenseVal) filters.license = licenseVal;
  if (params.get("hideArchived") === "true") filters.hideArchived = true;

  return { keyword, period, filters };
}

export function useDiscoveryUrl({
  keyword,
  period,
  filters,
  hasSearched,
  onRestoreState,
}: UseDiscoveryUrlOptions) {
  // 防止 state→URL→state feedback loop
  const isSyncingRef = useRef(false);
  // 追蹤是否從 URL 恢復了初始狀態
  const [hasUrlParams, setHasUrlParams] = useState(false);
  // 追蹤是否已完成初始化
  const initializedRef = useRef(false);
  // 保存最新的 onRestoreState 避免 stale closure
  const restoreRef = useRef(onRestoreState);
  restoreRef.current = onRestoreState;

  // 初始化：mount 時如果 hash 有參數 → 恢復狀態
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const restored = deserializeFromHash(window.location.hash);
    if (restored) {
      setHasUrlParams(true);
      isSyncingRef.current = true;
      restoreRef.current(restored);
      // 延遲重置 flag，確保 state→URL 同步跳過這一輪
      requestAnimationFrame(() => {
        isSyncingRef.current = false;
      });
    }
  }, []);

  // State → URL：狀態變更時更新 hash
  useEffect(() => {
    if (isSyncingRef.current) return;
    if (!hasSearched) {
      // 未搜尋時清除 hash
      if (window.location.hash) {
        window.history.replaceState(null, "", window.location.pathname);
      }
      return;
    }

    const newHash = serializeToHash(keyword, period, filters);
    const currentHash = window.location.hash || "";
    if (newHash !== currentHash) {
      window.history.replaceState(null, "", newHash || window.location.pathname);
    }
  }, [keyword, period, filters, hasSearched]);

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
