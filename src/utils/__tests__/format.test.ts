/**
 * Unit tests for format utilities
 */

import { describe, it, expect } from "vitest";
import { formatNumber, formatDelta, formatVelocity } from "../format";

describe("formatNumber", () => {
  it("formats null as dash", () => {
    expect(formatNumber(null)).toBe("—");
  });

  it("formats small numbers as is", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(50)).toBe("50");
    expect(formatNumber(999)).toBe("999");
  });

  it("formats numbers >= 1000 with k suffix", () => {
    expect(formatNumber(1000)).toBe("1.0k");
    expect(formatNumber(1500)).toBe("1.5k");
    expect(formatNumber(2345)).toBe("2.3k");
    expect(formatNumber(220000)).toBe("220.0k");
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

  it("formats large positive numbers with k suffix and plus sign", () => {
    expect(formatDelta(1000)).toBe("+1.0k");
    expect(formatDelta(2500)).toBe("+2.5k");
  });

  it("formats large negative numbers with k suffix", () => {
    expect(formatDelta(-1000)).toBe("-1.0k");
    expect(formatDelta(-2500)).toBe("-2.5k");
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
