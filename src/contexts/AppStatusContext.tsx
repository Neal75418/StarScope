/**
 * 應用狀態 Context，統一管理降級狀態。
 * 所有頁面透過 useAppStatus() 取得目前的降級狀態。
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useQuery } from "@tanstack/react-query";
import { checkHealth } from "../api/client";
import { queryKeys } from "../lib/react-query";

/** 應用降級狀態。 */
export type DegradationLevel = "online" | "offline" | "sidecar-down" | "rate-limited";

/** 降級狀態橫幅訊息的 i18n key。 */
export type StatusMessageKey = "offline" | "sidecarDown" | "rateLimited";

export interface AppStatus {
  /** 當前降級等級。 */
  level: DegradationLevel;
  /** 是否應顯示全域橫幅。 */
  showBanner: boolean;
  /** 橫幅訊息 key（對應 i18n status section）。 */
  bannerMessage: StatusMessageKey | null;
  /** Sidecar 是否可用。 */
  isSidecarUp: boolean;
  /** 是否在線。 */
  isOnline: boolean;
}

const AppStatusContext = createContext<AppStatus | undefined>(undefined);

/** 應用狀態 Provider。 */
export function AppStatusProvider({ children }: { children: ReactNode }) {
  const isOnline = useOnlineStatus();

  // Health check：離線時暫停，但頁面隱藏時仍繼續（偵測 sidecar 恢復）
  const healthQuery = useQuery({
    queryKey: queryKeys.dashboard.health,
    queryFn: checkHealth,
    retry: 1,
    staleTime: 30_000,
    refetchInterval: () => (isOnline ? 60_000 : false),
  });

  const isSidecarUp = healthQuery.data?.status === "ok";

  // 監聽 rate-limited 事件（由 apiCall 在 429 重試耗盡時廣播）
  const [isRateLimited, setRateLimited] = useState(false);
  const rateLimitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const handler = () => {
      setRateLimited(true);
      clearTimeout(rateLimitTimerRef.current);
      rateLimitTimerRef.current = setTimeout(() => setRateLimited(false), 60_000);
    };
    window.addEventListener("starscope:rate-limited", handler);
    return () => {
      window.removeEventListener("starscope:rate-limited", handler);
      clearTimeout(rateLimitTimerRef.current);
    };
  }, []);

  const status = useMemo<AppStatus>(() => {
    if (!isOnline) {
      return {
        level: "offline",
        showBanner: true,
        bannerMessage: "offline",
        isSidecarUp: false,
        isOnline: false,
      };
    }
    if (!isSidecarUp && !healthQuery.isLoading) {
      return {
        level: "sidecar-down",
        showBanner: true,
        bannerMessage: "sidecarDown",
        isSidecarUp: false,
        isOnline: true,
      };
    }
    if (isRateLimited) {
      return {
        level: "rate-limited",
        showBanner: true,
        bannerMessage: "rateLimited",
        isSidecarUp,
        isOnline: true,
      };
    }
    return {
      level: "online",
      showBanner: false,
      bannerMessage: null,
      isSidecarUp,
      isOnline: true,
    };
  }, [isOnline, isSidecarUp, healthQuery.isLoading, isRateLimited]);

  return <AppStatusContext.Provider value={status}>{children}</AppStatusContext.Provider>;
}

/** 取得應用降級狀態。 */
export function useAppStatus(): AppStatus {
  const ctx = useContext(AppStatusContext);
  if (!ctx) throw new Error("useAppStatus must be used within AppStatusProvider");
  return ctx;
}
