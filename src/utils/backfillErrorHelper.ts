/**
 * 回填丟出例外時給使用者看的一句話。
 */

import type { TranslationKeys } from "../i18n";
import { describeWriteFailure } from "./writeFailure";

/**
 * 依狀態碼與 code 說原因（逾時說不確定有沒有完成）。後端的原始訊息是英文內部用語，不上畫面；
 * 伺服器錯誤與逾時也不說成離線——離線時按鈕本來就不給按（useBackfillAction 先擋）。
 */
export function getBackfillErrorMessage(err: unknown, t: TranslationKeys): string {
  return describeWriteFailure(err, t, t.starHistory.backfillFailure);
}
