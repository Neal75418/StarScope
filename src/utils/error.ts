/**
 * 集中式錯誤處理工具，確保錯誤訊息一致性。
 */

import { ApiError } from "../api/client";

/**
 * 從任意錯誤中提取使用者友善的錯誤訊息。
 *
 * @param error - 捕獲的錯誤（可為 ApiError、Error 或 unknown）
 * @param fallbackMessage - 無法取得錯誤細節時的預設訊息
 * @returns 使用者友善的錯誤訊息
 */
export function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.detail || fallbackMessage;
  }

  if (error instanceof Error) {
    return error.message || fallbackMessage;
  }

  return fallbackMessage;
}
