/**
 * Unit tests for backfill helper functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isNetworkError, formatRelativeTime } from "../backfillHelpers";
import { ApiError } from "../../api/client";

describe("isNetworkError", () => {
  it("returns true for TypeError with 'Failed to fetch' message", () => {
    const error = new TypeError("Failed to fetch");
    expect(isNetworkError(error)).toBe(true);
  });

  it("returns false for TypeError with different message", () => {
    const error = new TypeError("Some other error");
    expect(isNetworkError(error)).toBe(false);
  });

  it("returns true for ApiError with status 0", () => {
    const error = new ApiError(0, "Network error");
    expect(isNetworkError(error)).toBe(true);
  });

  it("returns true for ApiError with status 500", () => {
    const error = new ApiError(500, "Internal server error");
    expect(isNetworkError(error)).toBe(true);
  });

  it("returns true for ApiError with status 503", () => {
    const error = new ApiError(503, "Service unavailable");
    expect(isNetworkError(error)).toBe(true);
  });

  it("returns false for ApiError with status 400", () => {
    const error = new ApiError(400, "Bad request");
    expect(isNetworkError(error)).toBe(false);
  });

  it("returns false for ApiError with status 404", () => {
    const error = new ApiError(404, "Not found");
    expect(isNetworkError(error)).toBe(false);
  });

  it("returns false for regular Error", () => {
    const error = new Error("Some error");
    expect(isNetworkError(error)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isNetworkError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isNetworkError(undefined)).toBe(false);
  });
});

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
});
