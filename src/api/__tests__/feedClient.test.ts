/**
 * Feed / Interests API client 測試。
 * 模式沿用同目錄既有 client 測試（client.test.ts）：mock global.fetch，
 * 驗證呼叫的 method、路徑與 body；回應採用統一 envelope {success, data}。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getInterests,
  createInterest,
  deleteInterest,
  getExclusions,
  addExclusion,
  removeExclusion,
  getFeed,
  generateFeed,
  sendFeedFeedback,
} from "../client";

// Mock fetch globally（沿用 client.test.ts 的作法）
const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockEnvelopeOnce(data: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true, data, message: null, error: null }),
  });
}

describe("interests client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getInterests calls GET /interests", async () => {
    mockEnvelopeOnce({ interests: [] });
    const result = await getInterests();
    expect(result.interests).toEqual([]);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/interests");
  });

  it("createInterest posts body", async () => {
    mockEnvelopeOnce({ id: 1, term: "tauri", kind: "topic", weight: 3 });
    const result = await createInterest({ term: "tauri", kind: "topic", weight: 3 });
    expect(result.term).toBe("tauri");
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/interests");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string).weight).toBe(3);
  });

  it("deleteInterest calls DELETE with id", async () => {
    mockEnvelopeOnce({ deleted: 5 });
    await deleteInterest(5);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/interests/5");
    expect(opts.method).toBe("DELETE");
  });

  it("getExclusions calls GET /interests/exclusions", async () => {
    mockEnvelopeOnce({ exclusions: [] });
    const result = await getExclusions();
    expect(result.exclusions).toEqual([]);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/interests/exclusions");
  });

  it("addExclusion posts term", async () => {
    mockEnvelopeOnce({ id: 1, term: "crypto" });
    const result = await addExclusion("crypto");
    expect(result.term).toBe("crypto");
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string).term).toBe("crypto");
  });

  it("removeExclusion calls DELETE with id", async () => {
    mockEnvelopeOnce({ deleted: 1 });
    await removeExclusion(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/interests/exclusions/1");
    expect(opts.method).toBe("DELETE");
  });
});

describe("feed client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getFeed calls GET /feed", async () => {
    mockEnvelopeOnce({ feed_date: "2026-08-01", items: [] });
    const result = await getFeed();
    expect(result.items).toEqual([]);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/feed");
  });

  it("generateFeed posts to /feed/generate", async () => {
    mockEnvelopeOnce({ feed_date: "2026-08-01", generated: 12 });
    const result = await generateFeed();
    expect(result.generated).toBe(12);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/feed/generate");
    expect(opts.method).toBe("POST");
  });

  it("sendFeedFeedback posts action to item endpoint", async () => {
    mockEnvelopeOnce({ id: 3, feedback: "dismissed" });
    await sendFeedFeedback(3, "dismissed");
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/feed/items/3/feedback");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string).action).toBe("dismissed");
  });
});
