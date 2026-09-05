/**
 * Early signal 的顯示文案。
 *
 * DB 的 description 欄是偵測當下寫死的英文字串，只當 fallback（舊資料列）
 * 與日誌用；結構化參數（velocity_value / baseline_value / star_count /
 * context_title）齊全時，由這裡依語系用模板渲染。
 */

import type { EarlySignal } from "../api/client";
import { interpolate, type TranslationKeys } from "../i18n";
import { formatNumber } from "./format";
import { logger } from "./logger";

/** 一位小數；整數不帶小數點（後端 description 用 .1f 永遠帶一位，這裡只求可讀） */
function fmtVelocity(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** 與後端相同的 50 字截斷規則 */
function truncateTitle(title: string): string {
  return title.length > 50 ? `${title.slice(0, 50)}…` : title;
}

export function formatSignalDescription(signal: EarlySignal, t: TranslationKeys): string {
  const copy = t.dashboard.signals.copy;

  switch (signal.signal_type) {
    case "rising_star":
      if (signal.star_count != null && signal.velocity_value != null) {
        return interpolate(copy.risingStar, {
          stars: formatNumber(signal.star_count),
          velocity: fmtVelocity(signal.velocity_value),
        });
      }
      break;
    case "sudden_spike":
      if (signal.velocity_value != null && signal.baseline_value != null) {
        return interpolate(copy.suddenSpike, {
          delta: formatNumber(Math.round(signal.velocity_value)),
          avg: formatNumber(Math.round(signal.baseline_value)),
        });
      }
      break;
    case "breakout":
      if (signal.velocity_value != null && signal.baseline_value != null) {
        return interpolate(copy.breakout, {
          prev: fmtVelocity(signal.baseline_value),
          current: fmtVelocity(signal.velocity_value),
        });
      }
      break;
    case "viral_hn":
      // viral_hn 的 velocity_value 存 HN 分數（此型沒有 velocity 概念）
      if (signal.context_title != null && signal.velocity_value != null) {
        return interpolate(copy.viralHn, {
          title: truncateTitle(signal.context_title),
          score: Math.round(signal.velocity_value),
        });
      }
      break;
  }

  // 走到這裡代表該型別缺結構化參數。升級前偵測的舊資料列會在 3–7 天內過期；
  // 新偵測的還走到這裡就是後端漏了參數——這個 fallback 對使用者無聲（英文字串混在
  // 中文介面裡、沒有任何標記），至少開發時要看得到
  logger.warn(`[signalCopy] ${signal.signal_type} #${signal.id} 缺模板參數，退回原始 description`);
  return signal.description;
}
