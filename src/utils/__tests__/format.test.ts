/**
 * Unit tests for format utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatNumber,
  formatDelta,
  formatVelocity,
  formatChartDate,
  formatTimeAgo,
  formatRelativeTime,
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
    expect(formatDelta(0)).toBe("+0");
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

describe("formatTimeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns '—' for invalid date string", () => {
    expect(formatTimeAgo("not-a-date")).toBe("—");
    expect(formatTimeAgo("")).toBe("—");
  });

  it("returns 'today' for current date", () => {
    expect(formatTimeAgo("2024-06-15T12:00:00Z")).toBe("<1d");
  });

  it("returns '1d ago' for yesterday", () => {
    expect(formatTimeAgo("2024-06-14T12:00:00Z")).toBe("1d");
  });

  it("returns days for dates within 30 days", () => {
    expect(formatTimeAgo("2024-06-10T12:00:00Z")).toBe("5d");
  });

  it("returns months for dates within a year", () => {
    expect(formatTimeAgo("2024-04-16T12:00:00Z")).toBe("2mo");
  });

  it("returns years for dates over a year", () => {
    expect(formatTimeAgo("2022-06-16T12:00:00Z")).toBe("2y");
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
