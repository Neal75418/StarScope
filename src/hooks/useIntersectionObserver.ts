/**
 * IntersectionObserver hook：當 sentinel 元素進入視窗時觸發回呼。
 * 用於 infinite scroll 等場景。
 */

import { useRef, useEffect, useState } from "react";

interface UseIntersectionObserverOptions {
  /** 進入視窗時觸發的回呼 */
  onIntersect: () => void;
  /** IntersectionObserver threshold (default 0) */
  threshold?: number;
  /** 提前觸發的邊距 (default "200px") */
  rootMargin?: string;
  /** 是否啟用觀察 (default true) */
  enabled?: boolean;
}

export function useIntersectionObserver({
  onIntersect,
  threshold = 0,
  rootMargin = "200px",
  enabled = true,
}: UseIntersectionObserverOptions) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isSupported] = useState(() => typeof IntersectionObserver !== "undefined");

  // 用 ref 存最新的 callback，避免 observer 重建
  const callbackRef = useRef(onIntersect);
  callbackRef.current = onIntersect;

  useEffect(() => {
    if (!isSupported || !enabled) return;

    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          callbackRef.current();
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isSupported, enabled, threshold, rootMargin]);

  return { sentinelRef, isSupported };
}
