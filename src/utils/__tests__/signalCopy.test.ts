/**
 * formatSignalDescription 測試：結構化參數齊全時依語系渲染模板，
 * 缺任一參數（舊資料列）時 fallback 顯示 DB 裡的英文 description。
 */
import { describe, it, expect } from "vitest";
import { formatSignalDescription } from "../signalCopy";
import { getTranslations } from "../../i18n";
import type { EarlySignal } from "../../api/client";

const en = getTranslations("en");
const zh = getTranslations("zh-TW");

function makeSignal(overrides: Partial<EarlySignal> = {}): EarlySignal {
  return {
    id: 1,
    repo_id: 1,
    repo_name: "a/one",
    signal_type: "sudden_spike",
    severity: "low",
    description: "Sudden spike: +130 stars/day (vs avg 36/day)",
    velocity_value: 130,
    star_count: 74731,
    percentile_rank: null,
    baseline_value: 36,
    context_title: null,
    detected_at: "2026-08-29T00:00:00Z",
    expires_at: null,
    acknowledged: false,
    acknowledged_at: null,
    ...overrides,
  };
}

describe("formatSignalDescription", () => {
  it("sudden_spike：兩語系模板", () => {
    const s = makeSignal();
    expect(formatSignalDescription(s, en)).toBe("Sudden spike: +130 stars/day (avg 36/day)");
    expect(formatSignalDescription(s, zh)).toBe("突然飆升：每日 +130 顆星（平均每日 36）");
  });

  it("sudden_spike 缺 baseline_value（舊資料列）→ fallback 原描述", () => {
    const s = makeSignal({ baseline_value: null });
    expect(formatSignalDescription(s, zh)).toBe("Sudden spike: +130 stars/day (vs avg 36/day)");
  });

  it("rising_star：stars 用縮寫、velocity 一位小數", () => {
    const s = makeSignal({
      signal_type: "rising_star",
      velocity_value: 123.46,
      star_count: 74731,
      baseline_value: null,
    });
    expect(formatSignalDescription(s, en)).toBe("Rising star: 74.7K stars, +123.5/day");
    expect(formatSignalDescription(s, zh)).toBe("新星崛起：74.7K 顆星、每日 +123.5");
  });

  it("breakout：前後 velocity", () => {
    const s = makeSignal({
      signal_type: "breakout",
      velocity_value: 12.3,
      baseline_value: 2,
    });
    expect(formatSignalDescription(s, en)).toBe("Breakout: velocity went from 2 to 12.3 stars/day");
    expect(formatSignalDescription(s, zh)).toBe("爆發突破：velocity 從每日 2 升到 12.3");
  });

  it("viral_hn：標題照原文（內容不翻譯）、超過 50 字截斷", () => {
    const longTitle = "A".repeat(60);
    const s = makeSignal({
      signal_type: "viral_hn",
      velocity_value: 528,
      context_title: longTitle,
      baseline_value: null,
    });
    const zhOut = formatSignalDescription(s, zh);
    expect(zhOut).toBe(`HN 熱門：「${"A".repeat(50)}…」（528 pts）`);
    expect(formatSignalDescription(s, en)).toBe(
      `Viral on HN: \u201c${"A".repeat(50)}\u2026\u201d (528 pts)`
    );
  });

  it("viral_hn 標題剛好 50 字不截斷、51 字才截", () => {
    const at = makeSignal({
      signal_type: "viral_hn",
      velocity_value: 10,
      context_title: "B".repeat(50),
      baseline_value: null,
    });
    const over = makeSignal({
      signal_type: "viral_hn",
      velocity_value: 10,
      context_title: "B".repeat(51),
      baseline_value: null,
    });
    expect(formatSignalDescription(at, zh)).toBe(`HN 熱門：「${"B".repeat(50)}」（10 pts）`);
    expect(formatSignalDescription(over, zh)).toBe(`HN 熱門：「${"B".repeat(50)}…」（10 pts）`);
  });

  it("viral_hn 缺 context_title（舊資料列）→ fallback", () => {
    const s = makeSignal({
      signal_type: "viral_hn",
      velocity_value: 528,
      context_title: null,
      description: 'Viral on HN: "Old row" (528 points)',
    });
    expect(formatSignalDescription(s, zh)).toBe('Viral on HN: "Old row" (528 points)');
  });
});
