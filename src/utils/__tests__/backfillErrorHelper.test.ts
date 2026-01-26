/**
 * Unit tests for backfill error helper
 */

import { describe, it, expect } from "vitest";
import { getBackfillErrorMessage } from "../backfillErrorHelper";
import { ApiError } from "../../api/client";

const mockT = {
  starHistory: {
    offlineNoBackfill: "Cannot backfill while offline",
    rateLimited: "Rate limit exceeded. Please try again later.",
    backfillFailed: "Failed to backfill star history",
  },
};

describe("getBackfillErrorMessage", () => {
  it("returns offline message for network error (TypeError)", () => {
    const error = new TypeError("Failed to fetch");
    expect(getBackfillErrorMessage(error, mockT)).toBe("Cannot backfill while offline");
  });

  it("returns offline message for ApiError with status 0", () => {
    const error = new ApiError(0, "Network error");
    expect(getBackfillErrorMessage(error, mockT)).toBe("Cannot backfill while offline");
  });

  it("returns offline message for ApiError with status 500+", () => {
    const error = new ApiError(503, "Service unavailable");
    expect(getBackfillErrorMessage(error, mockT)).toBe("Cannot backfill while offline");
  });

  it("returns rate limited message for ApiError with status 429", () => {
    const error = new ApiError(429, "Too many requests");
    expect(getBackfillErrorMessage(error, mockT)).toBe(
      "Rate limit exceeded. Please try again later."
    );
  });

  it("returns error detail for ApiError with other status codes", () => {
    const error = new ApiError(400, "Invalid repository format");
    expect(getBackfillErrorMessage(error, mockT)).toBe("Invalid repository format");
  });

  it("returns backfillFailed for ApiError with empty detail", () => {
    const error = new ApiError(400, "");
    expect(getBackfillErrorMessage(error, mockT)).toBe("Failed to backfill star history");
  });

  it("returns backfillFailed for regular Error", () => {
    const error = new Error("Some error");
    expect(getBackfillErrorMessage(error, mockT)).toBe("Failed to backfill star history");
  });

  it("returns backfillFailed for unknown error type", () => {
    expect(getBackfillErrorMessage("string error", mockT)).toBe("Failed to backfill star history");
  });

  it("uses fallback message when t.starHistory.offlineNoBackfill is undefined", () => {
    const error = new TypeError("Failed to fetch");
    const tWithoutOffline = { starHistory: {} };
    expect(getBackfillErrorMessage(error, tWithoutOffline)).toBe("Cannot backfill while offline");
  });

  it("uses fallback message when t.starHistory.rateLimited is undefined", () => {
    const error = new ApiError(429, "Too many requests");
    const tWithoutRateLimited = { starHistory: {} };
    expect(getBackfillErrorMessage(error, tWithoutRateLimited)).toBe(
      "Rate limit exceeded. Please try again later."
    );
  });
});
