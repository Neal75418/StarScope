import { describe, it, expect } from "vitest";
import { translations } from "../../i18n/translations";
import { describeDigestItem } from "../digestCopy";
import type { DigestItem } from "../../api/client";

const t = translations.en;
const repo = { id: 1, full_name: "o/r", url: "https://github.com/o/r" };
const base = {
  repo,
  occurred_at: "2026-09-25T00:00:00+00:00",
  url: null,
  tier: "highlight" as const,
};

describe("describeDigestItem", () => {
  it("release: title plus localized tags", () => {
    const item: DigestItem = {
      ...base,
      key: "release:1",
      kind: "release",
      title: "v3.0.0",
      tags: ["breaking", "security"],
    };
    expect(describeDigestItem(item, t).summary).toBe("v3.0.0 — breaking · security");
  });

  it("release tags follow the language (English labels happen to equal the raw tags)", () => {
    const item: DigestItem = {
      ...base,
      key: "release:1",
      kind: "release",
      title: "v3.0.0",
      tags: ["breaking", "security"],
    };
    expect(describeDigestItem(item, translations["zh-TW"]).summary).toBe(
      "v3.0.0 — 破壞性變更 · 安全性"
    );
  });

  it("release without tags is just the title", () => {
    const item: DigestItem = {
      ...base,
      key: "release:1",
      kind: "release",
      title: "v1.2.3",
      tags: [],
    };
    expect(describeDigestItem(item, t).summary).toBe("v1.2.3");
  });

  it("hn: score and title", () => {
    const item: DigestItem = { ...base, key: "hn:1", kind: "hn", title: "uv is fast", score: 312 };
    expect(describeDigestItem(item, t).summary).toBe("HN discussion, 312 points: uv is fast");
  });

  it("signal: reuses the early signal copy", () => {
    const item: DigestItem = {
      ...base,
      key: "signal:1",
      kind: "signal",
      signal: {
        id: 1,
        repo_id: 1,
        repo_name: "o/r",
        signal_type: "sudden_spike",
        severity: "high",
        description: "fallback",
        velocity_value: 1240,
        star_count: 9000,
        percentile_rank: null,
        baseline_value: 80,
        context_title: null,
        detected_at: "2026-09-25T00:00:00",
        expires_at: null,
        acknowledged: false,
        acknowledged_at: null,
      },
    };
    // 跟 SignalSpotlight 同一套模板（formatNumber 會把 1240 縮成 1.2K）
    expect(describeDigestItem(item, t).summary).toBe("Sudden spike: +1.2K stars/day (avg 80/day)");
  });

  it("alert: rule name and the value that triggered it", () => {
    const item: DigestItem = {
      ...base,
      key: "alert:1",
      kind: "alert",
      rule_name: "fast",
      signal_type: "velocity",
      operator: ">",
      threshold: 10,
      value: 42,
    };
    expect(describeDigestItem(item, t).summary).toContain("fast");
    expect(describeDigestItem(item, t).summary).toContain("42");
  });

  it("zh-TW has every digest key the English copy has", () => {
    expect(Object.keys(translations["zh-TW"].dashboard.digest).sort()).toEqual(
      Object.keys(translations.en.dashboard.digest).sort()
    );
  });
});
