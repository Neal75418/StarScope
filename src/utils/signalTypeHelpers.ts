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

/** Signal type key → 翻譯 label 的快速對映表。 */
const SIGNAL_TYPE_KEY_MAP: Record<string, string> = {
  rising_star: "risingStar",
  sudden_spike: "suddenSpike",
  breakout: "breakout",
  viral_hn: "viralHn",
  release_surge: "releaseSurge",
};

/** 從 signal_type 取得翻譯名稱（用於通知、活動、週報）。 */
export function getSignalDisplayName(
  signalType: string,
  signalLabels: Record<string, string>
): string {
  const key = SIGNAL_TYPE_KEY_MAP[signalType];
  return (key && signalLabels[key]) || signalType.replace(/_/g, " ");
}
