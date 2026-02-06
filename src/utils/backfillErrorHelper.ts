/**
 * 回填錯誤訊息的輔助函式。
 */

import { ApiError } from "../api/client";
import { isNetworkError } from "./backfillHelpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBackfillErrorMessage(err: unknown, t: any): string {
  if (isNetworkError(err)) {
    return t.starHistory.offlineNoBackfill ?? "Cannot backfill while offline";
  }

  if (err instanceof ApiError) {
    if (err.status === 429) {
      return t.starHistory.rateLimited ?? "Rate limit exceeded. Please try again later.";
    }
    return err.detail || t.starHistory.backfillFailed;
  }

  return t.starHistory.backfillFailed;
}
