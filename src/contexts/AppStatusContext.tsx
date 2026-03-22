/**
 * 應用狀態 Context，統一管理降級狀態。
 * 所有頁面透過 useAppStatus() 取得目前的降級狀態。
 */

import { createContext, useContext, useMemo, ReactNode } from "react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useQuery } from "@tanstack/react-query";
import { checkHealth } from "../api/client";
import { queryKeys } from "../lib/react-query";

/** 應用降級狀態。 */
export type DegradationLevel =
  | "online"
  | "offline"
  | "sidecar-down"
  | "rate-limited"
  | "partial-failure";

export interface AppStatus {
  /** 當前降級等級。 */
  level: DegradationLevel;
  /** 是否應顯示全域橫幅。 */
  showBanner: boolean;
  /** 橫幅訊息 key（對應 i18n status section）。 */
  bannerMessage: string | null;
  /** Sidecar 是否可用。 */
  isSidecarUp: boolean;
  /** 是否在線。 */
  isOnline: boolean;
}

const AppStatusContext = createContext<AppStatus | undefined>(undefined);

/** 應用狀態 Provider。 */
export function AppStatusProvider({ children }: { children: ReactNode }) {
  const isOnline = useOnlineStatus();

  const healthQuery = useQuery({
    queryKey: queryKeys.dashboard.health,
    queryFn: checkHealth,
    retry: 1,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const isSidecarUp = healthQuery.data?.status === "ok";

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
    return {
      level: "online",
      showBanner: false,
      bannerMessage: null,
      isSidecarUp,
      isOnline: true,
    };
  }, [isOnline, isSidecarUp, healthQuery.isLoading]);

  return <AppStatusContext.Provider value={status}>{children}</AppStatusContext.Provider>;
}

/** 取得應用降級狀態。 */
export function useAppStatus(): AppStatus {
  const ctx = useContext(AppStatusContext);
  if (!ctx) throw new Error("useAppStatus must be used within AppStatusProvider");
  return ctx;
}
