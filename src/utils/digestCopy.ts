/**
 * 摘要每一列的圖示與一句話結論。後端只給結構化欄位，文案在這裡依語系產生。
 */
import type { DigestItem } from "../api/client";
import { interpolate, type TranslationKeys } from "../i18n";
import { formatNumber } from "./format";
import { formatSignalDescription } from "./signalCopy";
import { getSignalDisplayName } from "./signalTypeHelpers";

const ICONS: Record<DigestItem["kind"], string> = {
  release: "📦",
  hn: "💬",
  signal: "🔥",
  alert: "🔔",
};

export function describeDigestItem(
  item: DigestItem,
  t: TranslationKeys
): { icon: string; summary: string } {
  const copy = t.dashboard.digest;
  switch (item.kind) {
    case "release": {
      const tags = item.tags
        .map(
          (tag) =>
            t.dashboard.weekly.releaseTags[tag as keyof typeof t.dashboard.weekly.releaseTags] ??
            tag
        )
        .join(" · ");
      const security = item.tags.includes("security") || item.tags.includes("breaking");
      return {
        icon: security ? "🔴" : ICONS.release,
        summary: tags ? `${item.title} — ${tags}` : item.title,
      };
    }
    case "hn":
      return {
        icon: ICONS.hn,
        summary: interpolate(copy.hnSummary, {
          score: item.score == null ? "?" : formatNumber(item.score),
          title: item.title,
        }),
      };
    case "signal":
      return { icon: ICONS.signal, summary: formatSignalDescription(item.signal, t) };
    case "alert":
      return {
        icon: ICONS.alert,
        summary: interpolate(copy.alertSummary, {
          rule: item.rule_name,
          signal: getSignalDisplayName(item.signal_type, t.dashboard.signals.types),
          operator: item.operator,
          threshold: item.threshold,
          value: item.value,
        }),
      };
  }
}
