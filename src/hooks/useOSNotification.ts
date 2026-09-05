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

  // 初始化：檢查權限狀態（非 Tauri 環境直接跳過）
  useEffect(() => {
    const checkPermission = async () => {
      // 非 Tauri 環境（瀏覽器開發模式）— 通知 API 不可用
      if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
        setIsGranted(false);
        setIsLoading(false);
        return;
      }

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
        // sendNotification 的簽名是 (options) => void。npm 包裡是 new window.Notification()，
        // 但 Tauri webview 裡的 window.Notification 已被 plugin 注入的 shim 換掉
        // （tauri-plugin-notification guest-js/init.ts）：那是 async 的 invoke，而且 promise
        // 被 void 掉——「交出去」之後的失敗（權限被收回、capability 缺）在這裡觀察不到。
        // 下面的 catch 只接得到同步 throw（瀏覽器模式、或 shim 沒注入）。
        // 沒有 await 是因為回傳值不是 promise，不代表它一定同步完成。
        sendNotification({
          title: options.title,
          body: options.body,
          icon: options.icon,
        });

        logger.info(`[OS Notification] 已交給系統: ${options.title}`); // 送達與否在此不可觀察
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
