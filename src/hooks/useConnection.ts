/**
 * Sidecar 連線狀態管理。
 */

import { useState, useCallback } from "react";
import { checkHealth } from "../api/client";
import { useI18n } from "../i18n";

export function useConnection() {
  const { t } = useI18n();
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const checkConnection = useCallback(async (): Promise<boolean> => {
    try {
      await checkHealth();
      setIsConnected(true);
      setConnectionError(null);
      return true;
    } catch {
      setIsConnected(false);
      setConnectionError(t.watchlist.connection.message);
      return false;
    }
  }, [t.watchlist.connection.message]);

  return {
    isConnected,
    connectionError,
    checkConnection,
  };
}
