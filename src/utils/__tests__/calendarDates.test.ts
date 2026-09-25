/**
 * 只有日期的值（快照日期 "2026-09-25"）是日曆上的一天，不是時間點：
 * new Date("2026-09-25") 是 UTC 午夜，用本地時區格式化會在 UTC 以西（美洲）變成前一天。
 * 反過來，給使用者看的「今天」（檔名上的日期）要用本地日期，不是 UTC 的。
 */
import { describe, it, expect, afterEach } from "vitest";
import { formatCalendarDate, localDateStamp } from "../format";

const originalTz = process.env.TZ;

function useTimeZone(tz: string) {
  process.env.TZ = tz;
}

afterEach(() => {
  // 寫進 process.env 的值會被轉成字串：undefined 會變成 "undefined"（無效時區＝UTC）
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("formatCalendarDate", () => {
  it("keeps the calendar day west of UTC", () => {
    useTimeZone("America/Los_Angeles");
    expect(formatCalendarDate("2026-09-25", "en-US")).toBe("9/25/2026");
  });

  it("keeps the calendar day east of UTC", () => {
    useTimeZone("Asia/Taipei");
    expect(formatCalendarDate("2026-09-25", "en-US")).toBe("9/25/2026");
  });

  it("shows a dash for something that is not a date", () => {
    expect(formatCalendarDate("not-a-date", "en-US")).toBe("—");
  });
});

describe("localDateStamp", () => {
  it("uses the local day, not the UTC day", () => {
    useTimeZone("Asia/Taipei");
    // UTC 9/25 20:00＝台北 9/26 04:00：UTC 日期會把檔名寫成昨天
    expect(localDateStamp(new Date("2026-09-25T20:00:00Z"))).toBe("2026-09-26");
  });

  it("pads month and day", () => {
    useTimeZone("UTC");
    expect(localDateStamp(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });
});
