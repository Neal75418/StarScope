/**
 * sidecar 的時間是 naive UTC（DB 慣例），序列化出來不帶時區；new Date() 會把
 * 不帶時區的「日期＋時間」當成本地時間，台灣會讓「1 小時前」顯示成「9h」。
 * 所有 API 回應都在 client 這一個關口補上 Z。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { normalizeApiTimestamps } from "../timestamps";
import { listEarlySignals } from "../client";
import { formatRelativeTime } from "../../utils/format";

describe("normalizeApiTimestamps", () => {
  it.each([
    ["2026-09-25T12:00:00", "2026-09-25T12:00:00Z"],
    ["2026-09-25T12:00:00.139828", "2026-09-25T12:00:00.139828Z"],
    ["2026-09-25T12:00", "2026-09-25T12:00Z"],
  ])("treats %s as UTC", (input, expected) => {
    expect(normalizeApiTimestamps(input)).toBe(expected);
  });

  it.each([
    "2026-09-25T12:00:00Z",
    "2026-09-25T12:00:00+00:00",
    "2026-09-25T20:00:00+08:00",
    "2026-09-25T12:00:00.5-05:00",
    "2026-09-25", // 只有日期：new Date() 本來就當 UTC
    "v2026-09-25T12:00:00",
    "released 2026-09-25T12:00:00",
    "",
  ])("leaves %s alone", (input) => {
    expect(normalizeApiTimestamps(input)).toBe(input);
  });

  it("walks nested objects and arrays, leaving other values untouched", () => {
    const input = {
      signals: [
        { detected_at: "2026-09-25T12:00:00", velocity: 3, acknowledged: false, note: null },
      ],
      digest: { cursor: { context_signal_id: 1 }, last_seen_at: "2026-09-24T00:00:00" },
      created_at: "2020-01-01T00:00:00Z",
    };

    expect(normalizeApiTimestamps(input)).toEqual({
      signals: [
        { detected_at: "2026-09-25T12:00:00Z", velocity: 3, acknowledged: false, note: null },
      ],
      digest: { cursor: { context_signal_id: 1 }, last_seen_at: "2026-09-24T00:00:00Z" },
      created_at: "2020-01-01T00:00:00Z",
    });
  });
});

describe("API responses", () => {
  const originalTz = process.env.TZ;
  const mockFetch = vi.fn();

  beforeAll(() => {
    // CI 跑在 UTC：不帶時區的字串在 UTC 下剛好被當成對的時間，看不出這個 bug
    process.env.TZ = "Asia/Taipei";
    vi.stubGlobal("fetch", mockFetch);
  });

  afterAll(() => {
    // 寫進 process.env 的值會被轉成字串：undefined 會變成 "undefined"（無效時區＝UTC）
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
    vi.unstubAllGlobals();
  });

  it("a signal detected an hour ago reads as 1h in Taipei, not 9h", async () => {
    // early signal 的 detected_at 由 EarlySignalResponse 序列化，不帶時區（digest 的時間則已帶 +00:00）
    const oneHourAgoNaiveUtc = new Date(Date.now() - 3_600_000).toISOString().slice(0, 19);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { signals: [{ id: 1, detected_at: oneHourAgoNaiveUtc }], total: 1 },
        message: null,
        error: null,
      }),
    });

    const { signals } = await listEarlySignals();

    expect(formatRelativeTime(signals[0].detected_at)).toBe("1h");
  });
});
