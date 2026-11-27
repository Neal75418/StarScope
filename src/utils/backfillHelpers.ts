/**
 * 回填相關的輔助函式。
 */

import { ApiError } from "../api/client";
import { formatRelativeTime as formatRelativeTimeBase } from "./format";

/** 回填只接受星數不超過這個數的 repo（與後端 MAX_STARS_FOR_BACKFILL 一致）。 */
export const MAX_STARS_FOR_BACKFILL = 5000;

/** 判斷是否為網路錯誤。 */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && err.message === "Failed to fetch") {
    return true;
  }
  return err instanceof ApiError && (err.status === 0 || err.status >= 500);
}

/** 格式化相對時間（委託給 format.ts 的統一實作）。 */
export function formatRelativeTime(
  date: Date | null,
  justNowText: string,
  suffix = " ago"
): string {
  return formatRelativeTimeBase(date, { justNowText, suffix });
}
