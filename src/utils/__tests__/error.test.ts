/**
 * Unit tests for error utility — getErrorMessage
 */

import { describe, it, expect } from "vitest";
import { getErrorMessage } from "../error";
import { ApiError } from "../../api/client";

const FALLBACK = "Something went wrong";

describe("getErrorMessage", () => {
  it("returns detail from ApiError instance", () => {
    const error = new ApiError(400, "Bad request");
    expect(getErrorMessage(error, FALLBACK)).toBe("Bad request");
  });

  it("returns fallback when ApiError.detail is empty string", () => {
    const error = new ApiError(500, "");
    expect(getErrorMessage(error, FALLBACK)).toBe(FALLBACK);
  });

  it("returns message from Error instance", () => {
    const error = new Error("Network failure");
    expect(getErrorMessage(error, FALLBACK)).toBe("Network failure");
  });

  it("returns fallback when Error.message is empty string", () => {
    const error = new Error("");
    expect(getErrorMessage(error, FALLBACK)).toBe(FALLBACK);
  });

  it("returns fallback for string input", () => {
    expect(getErrorMessage("some string error", FALLBACK)).toBe(FALLBACK);
  });

  it("returns fallback for number input", () => {
    expect(getErrorMessage(42, FALLBACK)).toBe(FALLBACK);
  });

  it("returns fallback for null", () => {
    expect(getErrorMessage(null, FALLBACK)).toBe(FALLBACK);
  });

  it("returns fallback for undefined", () => {
    expect(getErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it("returns fallback for plain object", () => {
    expect(getErrorMessage({ message: "ignored" }, FALLBACK)).toBe(FALLBACK);
  });

  it("prioritises ApiError.detail over Error.message (ApiError extends Error)", () => {
    // ApiError extends Error, so instanceof Error is also true.
    // The function checks ApiError first, so detail wins.
    const error = new ApiError(422, "Validation failed");
    expect(getErrorMessage(error, FALLBACK)).toBe("Validation failed");
  });
});
