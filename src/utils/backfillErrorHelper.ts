/**
 * 回填錯誤訊息的輔助函式。
 */

import { ApiError } from "../api/client";
import { TranslationKeys } from "../i18n/translations";
import { isNetworkError } from "./backfillHelpers";

export function getBackfillErrorMessage(err: unknown, t: TranslationKeys): string {
  if (isNetworkError(err)) {
    return t.starHistory.offlineNoBackfill;
  }

  if (err instanceof ApiError) {
    if (err.status === 429) {
      return t.starHistory.rateLimited;
    }
    return err.detail || t.starHistory.backfillFailed;
  }

  return t.starHistory.backfillFailed;
}
