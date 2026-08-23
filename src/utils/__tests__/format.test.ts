/**
 * Unit tests for format utilities
 */

import { describe, it, expect } from "vitest";
import {
  deltaClass,
  formatChartDate,
  formatDayCount,
  formatDelta,
  formatNumber,
  formatRelativeTime,
  formatVelocity,
  trendClass,
} from "../format";

describe("formatNumber", () => {
  it("formats null as dash", () => {
    expect(formatNumber(null)).toBe("—");
  });

  it("formats small numbers as is", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(50)).toBe("50");
    expect(formatNumber(999)).toBe("999");
  });

  it("formats numbers >= 1000 with K suffix", () => {
    expect(formatNumber(1000)).toBe("1.0K");
    expect(formatNumber(1500)).toBe("1.5K");
    expect(formatNumber(2345)).toBe("2.3K");
    expect(formatNumber(220000)).toBe("220.0K");
  });

  it("formats numbers >= 1000000 with M suffix", () => {
    expect(formatNumber(1000000)).toBe("1.0M");
    expect(formatNumber(1500000)).toBe("1.5M");
    expect(formatNumber(2345678)).toBe("2.3M");
  });

  it("formats decimal numbers correctly", () => {
    expect(formatNumber(50.5)).toBe("50.5");
    expect(formatNumber(999.7)).toBe("999.7");
  });

  it("formats whole numbers without decimals", () => {
    expect(formatNumber(50.0)).toBe("50");
    expect(formatNumber(100.0)).toBe("100");
  });
});

describe("formatDelta", () => {
  it("formats null as dash", () => {
    expect(formatDelta(null)).toBe("—");
  });

  it("adds plus sign for positive numbers", () => {
    expect(formatDelta(0)).toBe("0");
    expect(formatDelta(50)).toBe("+50");
    expect(formatDelta(999)).toBe("+999");
  });

  it("keeps minus sign for negative numbers", () => {
    expect(formatDelta(-50)).toBe("-50");
    expect(formatDelta(-999)).toBe("-999");
  });

  it("formats large positive numbers with K suffix and plus sign", () => {
    expect(formatDelta(1000)).toBe("+1.0K");
    expect(formatDelta(2500)).toBe("+2.5K");
  });

  it("formats large negative numbers with K suffix", () => {
    expect(formatDelta(-1000)).toBe("-1.0K");
    expect(formatDelta(-2500)).toBe("-2.5K");
  });

  it("formats million-scale numbers with M suffix", () => {
    expect(formatDelta(1000000)).toBe("+1.0M");
    expect(formatDelta(-1500000)).toBe("-1.5M");
  });
});

describe("formatVelocity", () => {
  it("formats null as dash", () => {
    expect(formatVelocity(null)).toBe("—");
  });

  it("formats velocity with /day suffix", () => {
    expect(formatVelocity(0)).toBe("0.0/day");
    expect(formatVelocity(50.5)).toBe("50.5/day");
    expect(formatVelocity(71.4)).toBe("71.4/day");
  });

  it("formats velocity to 1 decimal place", () => {
    expect(formatVelocity(50.123)).toBe("50.1/day");
    expect(formatVelocity(99.999)).toBe("100.0/day");
  });
});

describe("formatChartDate", () => {
  it("formats ISO date string to M/D format", () => {
    expect(formatChartDate("2024-01-15")).toBe("1/15");
    expect(formatChartDate("2024-12-25")).toBe("12/25");
  });

  it("formats ISO datetime string to M/D format", () => {
    expect(formatChartDate("2024-01-15T12:30:00Z")).toBe("1/15");
    expect(formatChartDate("2024-06-01T00:00:00Z")).toBe("6/1");
  });
});

describe("formatRelativeTime", () => {
  it("returns empty string for null", () => {
    expect(formatRelativeTime(null)).toBe("");
  });

  it("returns dash for invalid date string", () => {
    expect(formatRelativeTime("invalid")).toBe("—");
  });

  it("returns default justNow for recent date", () => {
    expect(formatRelativeTime(new Date())).toBe("<1m");
  });

  it("returns custom justNowText", () => {
    expect(formatRelativeTime(new Date(), { justNowText: "just now" })).toBe("just now");
  });

  it("returns relative time with suffix", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400000);
    expect(formatRelativeTime(fiveDaysAgo, { suffix: " ago" })).toBe("5d ago");
  });

  it("returns relative time without suffix by default", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400000);
    expect(formatRelativeTime(fiveDaysAgo)).toBe("5d");
  });
});

describe("formatDayCount", () => {
  // 推薦卡只拿得到 age_days，但它顯示在「最近更新 4h」旁邊，
  // 要用同一套縮寫才不會一列裡出現兩種寫法
  it("未滿 30 天用天", () => {
    expect(formatDayCount(0)).toBe("0d");
    expect(formatDayCount(7)).toBe("7d");
    expect(formatDayCount(29)).toBe("29d");
  });

  it("滿 30 天換成月，與 formatRelativeTime 的門檻一致", () => {
    expect(formatDayCount(30)).toBe("1mo");
    expect(formatDayCount(45)).toBe("1mo");
    expect(formatDayCount(364)).toBe("12mo");
  });

  it("滿一年換成年", () => {
    expect(formatDayCount(365)).toBe("1y");
    expect(formatDayCount(800)).toBe("2y");
  });

  it("門檻與 formatRelativeTime 對得起來——同一列不能一個說 29d 一個說 1mo", () => {
    const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    for (const n of [7, 29, 30, 200, 365]) {
      expect(formatDayCount(n)).toBe(formatRelativeTime(days(n)));
    }
  });
});

describe("deltaClass", () => {
  // 掃描時把 invert 分支整個拿掉（isPositive = v > 0），全套測試依然綠——
  // deltaClass 一條測試都沒有。它決定趨勢頁與 repo 卡片上每個增量的顏色。
  it("colours a rise as positive and a fall as negative by default", () => {
    expect(deltaClass(120)).toBe("positive");
    expect(deltaClass(-58)).toBe("negative");
  });

  it("flips the meaning when invert is set — more open issues is bad news", () => {
    // 唯一的 invert 消費者是 TrendRow 的「Issue 7 天Δ」。壞掉的話 issue 暴增
    // 會顯示成綠色，而數字本身完全正常，看不出哪裡不對。
    expect(deltaClass(30, true)).toBe("negative");
    expect(deltaClass(-30, true)).toBe("positive");
  });

  it("gives zero no direction at all — neither colour", () => {
    // 「持平」不是好消息也不是壞消息。回任一方向色都會讓一整排沒動的東西
    // 染上顏色，而顏色是這兩頁唯一的視覺重點。
    expect(deltaClass(0)).toBe("");
    expect(deltaClass(0, true)).toBe("");
  });

  it("treats missing data as no direction, not as a rise", () => {
    // null 是「量不到」不是「值為零」，但兩者在這裡的**顯示**必須一致：
    // 都不該染色。染成 positive 的話沒有資料的欄位會看起來像在成長。
    expect(deltaClass(null)).toBe("");
    expect(deltaClass(undefined)).toBe("");
  });
});

describe("trendClass", () => {
  it("maps direction to the trend-up / trend-down pair", () => {
    expect(trendClass(5)).toBe("trend-up");
    expect(trendClass(-5)).toBe("trend-down");
    expect(trendClass(0)).toBe("");
    expect(trendClass(null)).toBe("");
  });
});

describe("formatRelativeTime 的未來時間 guard", () => {
  it("treats a future timestamp as just now rather than a negative age", () => {
    // GitHub 偶爾回傳未來的 pushed_at（時鐘偏差）。少了 `diffMs < 0` 那個 guard
    // 會一路算下去印出「-3m」之類的負數年齡——掃描時拿掉它全套測試依然綠。
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(future, { justNowText: "剛剛" })).toBe("剛剛");
  });
});
