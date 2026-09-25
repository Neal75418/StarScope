import { describe, it, expect } from "vitest";
import { mergeDigest, hasHighlights } from "../digest";
import type { DigestItem, DigestResponse } from "../../api/client";

const repo = { id: 1, full_name: "o/r", url: "https://github.com/o/r" };

function release(key: string, tier: "highlight" | "other", occurredAt: string): DigestItem {
  return {
    key,
    tier,
    kind: "release",
    repo,
    occurred_at: occurredAt,
    url: null,
    title: key,
    tags: [],
  };
}

function digest(items: DigestItem[], over: Partial<DigestResponse> = {}): DigestResponse {
  return {
    items,
    other_total: items.filter((i) => i.tier === "other").length,
    cursor: { context_signal_id: 1, early_signal_id: 0, triggered_alert_id: 0 },
    last_seen_at: "2026-09-22T00:00:00+00:00",
    releases_checked: true,
    ...over,
  };
}

describe("mergeDigest", () => {
  it("appends new items, keeps the session's last_seen_at, takes the newer cursor", () => {
    const prev = digest([release("release:1", "other", "2026-09-24T00:00:00+00:00")]);
    const next = digest([release("release:2", "highlight", "2026-09-25T00:00:00+00:00")], {
      cursor: { context_signal_id: 2, early_signal_id: 0, triggered_alert_id: 0 },
      last_seen_at: "2026-09-25T09:00:00+00:00",
    });

    const merged = mergeDigest(prev, next);

    // 重點在前，接著其他更新；同層新到舊
    expect(merged.items.map((i) => i.key)).toEqual(["release:2", "release:1"]);
    expect(merged.cursor.context_signal_id).toBe(2);
    // 「上次看過」要停在這次開 app 之前的那個時間，不能被剛剛自己推進的游標蓋掉
    expect(merged.last_seen_at).toBe("2026-09-22T00:00:00+00:00");
    expect(merged.other_total).toBe(1);
  });

  it("takes the newest response's cursor even when it went down", () => {
    // 刪除之後後端會把游標壓低：新回應的 cursor 比這批舊的還小。取 max 的話會把
    // 舊的高值再送回去，把重用 id 的新列標成看過
    const prev = digest([], {
      cursor: { context_signal_id: 5, early_signal_id: 4, triggered_alert_id: 3 },
    });
    const next = digest([], {
      cursor: { context_signal_id: 2, early_signal_id: 4, triggered_alert_id: 1 },
    });

    expect(mergeDigest(prev, next).cursor).toEqual(next.cursor);
  });

  it("does not duplicate an item that arrives twice", () => {
    const item = release("release:1", "other", "2026-09-24T00:00:00+00:00");

    const merged = mergeDigest(digest([item]), digest([item]));

    expect(merged.items).toHaveLength(1);
    expect(merged.other_total).toBe(1);
  });
});

describe("hasHighlights", () => {
  it("is true only when there is at least one highlight", () => {
    expect(hasHighlights(undefined)).toBe(false);
    expect(
      hasHighlights(digest([release("release:1", "other", "2026-09-24T00:00:00+00:00")]))
    ).toBe(false);
    expect(
      hasHighlights(digest([release("release:1", "highlight", "2026-09-24T00:00:00+00:00")]))
    ).toBe(true);
  });
});
