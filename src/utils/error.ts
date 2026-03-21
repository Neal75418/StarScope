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

/** 從錯誤中提取結構化錯誤碼（僅 ApiError 有）。 */
export function getErrorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

/** 判斷錯誤是否為可重試的（伺服器錯誤或外部 API 錯誤）。 */
export function isRetryableError(error: unknown): boolean {
  return error instanceof ApiError && error.isRetryable;
}
