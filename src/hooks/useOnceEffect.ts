/**
 * 只在掛載時執行一次的 effect，自動防護 StrictMode 雙重觸發。
 */

import { useEffect, useRef } from "react";

export function useOnceEffect(effect: () => void | (() => void)): void {
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;
    const cleanup = effect();
    return () => {
      // StrictMode 會 unmount 再 re-mount，重置 flag 讓 re-mount 時能重新執行
      hasRunRef.current = false;
      if (typeof cleanup === "function") cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
