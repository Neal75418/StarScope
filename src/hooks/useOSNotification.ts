/**
 * OS 層級通知管理 Hook
 * 使用 Tauri notification plugin 發送系統通知
 */

import { useCallback, useEffect, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { logger } from "../utils/logger";

interface OSNotificationOptions {
  title: string;
  body: string;
  icon?: string;
}

interface UseOSNotificationResult {
  isGranted: boolean;
  isLoading: boolean;
  requestNotificationPermission: () => Promise<boolean>;
  sendOSNotification: (options: OSNotificationOptions) => Promise<void>;
}

/**
 * OS 通知 Hook
 *
 * 功能：
 * - 檢查通知權限狀態
 * - 請求通知權限
 * - 發送 OS 層級通知
 *
 * 使用範例：
 * ```ts
 * const { isGranted, sendOSNotification } = useOSNotification();
 *
 * if (isGranted) {
 *   await sendOSNotification({
 *     title: "Star 增速異常",
 *     body: "torvalds/linux 的 velocity 達到 125.5",
 *   });
 * }
 * ```
 */
export function useOSNotification(): UseOSNotificationResult {
  const [isGranted, setIsGranted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // 初始化：檢查權限狀態
  useEffect(() => {
    const checkPermission = async () => {
      try {
        const granted = await isPermissionGranted();
        setIsGranted(granted);
      } catch (err) {
        logger.error("[OS Notification] 檢查權限失敗:", err);
        setIsGranted(false);
      } finally {
        setIsLoading(false);
      }
    };

    void checkPermission();
  }, []);

  // 請求通知權限
  const requestNotificationPermission = useCallback(async (): Promise<boolean> => {
    try {
      const permission = await requestPermission();
      const granted = permission === "granted";
      setIsGranted(granted);

      if (!granted) {
        logger.warn("[OS Notification] 通知權限被拒絕");
      }

      return granted;
    } catch (err) {
      logger.error("[OS Notification] 請求權限失敗:", err);
      return false;
    }
  }, []);

  // 發送 OS 通知
  const sendOSNotification = useCallback(
    async (options: OSNotificationOptions): Promise<void> => {
      // 如果沒有權限，不發送通知
      if (!isGranted) {
        logger.warn("[OS Notification] 未授予通知權限，跳過發送");
        return;
      }

      try {
        await sendNotification({
          title: options.title,
          body: options.body,
          icon: options.icon,
        });

        logger.info(`[OS Notification] 已發送: ${options.title}`);
      } catch (err) {
        logger.error("[OS Notification] 發送失敗:", err);
        throw err;
      }
    },
    [isGranted]
  );

  return {
    isGranted,
    isLoading,
    requestNotificationPermission,
    sendOSNotification,
  };
}
