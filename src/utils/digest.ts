/**
 * 「自上次以來」摘要的純函式。
 */
import type { DigestItem, DigestResponse } from "../api/client";

function byTierThenNewest(a: DigestItem, b: DigestItem): number {
  if (a.tier !== b.tier) return a.tier === "highlight" ? -1 : 1;
  return b.occurred_at.localeCompare(a.occurred_at);
}

/** 重整後把新抓到的附加到這次開 app 的那批；last_seen_at 保留開 app 當時的值 */
export function mergeDigest(prev: DigestResponse, next: DigestResponse): DigestResponse {
  const seen = new Set(prev.items.map((i) => i.key));
  const added = next.items.filter((i) => !seen.has(i.key));
  const addedOthers = added.filter((i) => i.tier === "other").length;
  return {
    items: [...prev.items, ...added].sort(byTierThenNewest),
    other_total: prev.other_total + addedOthers,
    // 取最新回應的 cursor，不取 max：刪除後後端會把游標壓低，新回應的 cursor 可能比這批舊的小，
    // 取 max 會把舊的高值再送回去、把重用 id 的新列標成看過
    cursor: next.cursor,
    last_seen_at: prev.last_seen_at,
    releases_checked: next.releases_checked,
  };
}

export function hasHighlights(digest: DigestResponse | undefined): boolean {
  return digest?.items.some((i) => i.tier === "highlight") ?? false;
}
