/**
 * 訊號類型的圖示與樣式對應。
 * 統一管理所有 signal type 的顯示設定，避免各頁面重複定義。
 */

import { EarlySignalType } from "../api/client";

export interface SignalTypeDisplay {
  icon: string;
  className: string;
}

export const SIGNAL_TYPE_CONFIG: Record<EarlySignalType, SignalTypeDisplay> = {
  rising_star: { icon: "\u{1F31F}", className: "signal-rising-star" },
  sudden_spike: { icon: "\u26A1", className: "signal-sudden-spike" },
  breakout: { icon: "\u{1F680}", className: "signal-breakout" },
  viral_hn: { icon: "\u{1F536}", className: "signal-viral-hn" },
  release_surge: { icon: "\u{1F4E6}", className: "signal-release-surge" },
};

const SIGNAL_TYPE_FALLBACK: SignalTypeDisplay = {
  icon: "?",
  className: "",
};

export function getSignalTypeConfig(type: string): SignalTypeDisplay {
  return SIGNAL_TYPE_CONFIG[type as EarlySignalType] ?? SIGNAL_TYPE_FALLBACK;
}
