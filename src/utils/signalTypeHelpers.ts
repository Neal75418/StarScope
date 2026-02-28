/**
 * Signal Type 相關的輔助函數。
 */

import { SignalTypeInfo } from "../api/client";

/**
 * 取得翻譯後的訊號類型名稱。
 * 優先使用 i18n 翻譯，回退到 API 提供的名稱，最後回退到原始 type。
 */
export function getSignalTypeLabel(
  type: string,
  signalTypes: SignalTypeInfo[],
  i18nConditions: Record<string, string>
): string {
  // 優先使用 i18n 翻譯
  const conditionKey = type as keyof typeof i18nConditions;
  if (i18nConditions[conditionKey]) {
    return i18nConditions[conditionKey];
  }

  // 回退到 API 提供的名稱
  const signalType = signalTypes.find((s) => s.type === type);
  return signalType?.name ?? type;
}
