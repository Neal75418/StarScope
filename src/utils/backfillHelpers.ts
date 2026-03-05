/**
 * 回填相關的輔助函式。
 */

import { ApiError } from "../api/client";
import { formatRelativeTime as formatRelativeTimeBase } from "./format";

// 判斷是否為網路錯誤
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && err.message === "Failed to fetch") {
    return true;
  }
  return err instanceof ApiError && (err.status === 0 || err.status >= 500);
}

// 格式化相對時間（委託給 format.ts 的統一實作）
export function formatRelativeTime(date: Date | null, justNowText: string): string {
  return formatRelativeTimeBase(date, { justNowText, suffix: " ago" });
}
