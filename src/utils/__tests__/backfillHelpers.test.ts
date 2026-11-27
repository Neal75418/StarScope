/**
 * Unit tests for backfill helper functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatRelativeTime } from "../backfillHelpers";

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty string for null date", () => {
    expect(formatRelativeTime(null, "Just now")).toBe("");
  });

  it("returns justNowText for time less than 1 minute ago", () => {
    const date = new Date("2024-01-15T11:59:30Z");
    expect(formatRelativeTime(date, "Just now")).toBe("Just now");
  });

  it("returns minutes ago for time between 1 and 59 minutes", () => {
    const date = new Date("2024-01-15T11:30:00Z");
    expect(formatRelativeTime(date, "Just now")).toBe("30m ago");
  });

  it("returns 1m ago for exactly 1 minute", () => {
    const date = new Date("2024-01-15T11:59:00Z");
    expect(formatRelativeTime(date, "Just now")).toBe("1m ago");
  });

  it("returns hours ago for time between 1 and 23 hours", () => {
    const date = new Date("2024-01-15T09:00:00Z");
    expect(formatRelativeTime(date, "Just now")).toBe("3h ago");
  });

  it("returns 1h ago for exactly 60 minutes", () => {
    const date = new Date("2024-01-15T11:00:00Z");
    expect(formatRelativeTime(date, "Just now")).toBe("1h ago");
  });

  it("returns days ago for time 24+ hours ago", () => {
    const date = new Date("2024-01-13T12:00:00Z");
    expect(formatRelativeTime(date, "Just now")).toBe("2d ago");
  });

  it("returns 1d ago for exactly 24 hours", () => {
    const date = new Date("2024-01-14T12:00:00Z");
    expect(formatRelativeTime(date, "Just now")).toBe("1d ago");
  });

  it("appends custom suffix when provided", () => {
    const date = new Date("2024-01-15T11:30:00Z"); // 30 分鐘前
    expect(formatRelativeTime(date, "剛剛", "前")).toBe("30m前");
  });
});
