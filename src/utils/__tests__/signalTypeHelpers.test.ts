import { describe, it, expect } from "vitest";
import { getSignalTypeLabel, getSignalDisplayName } from "../signalTypeHelpers";

describe("getSignalTypeLabel", () => {
  const signalTypes = [{ type: "velocity", name: "Velocity", description: "", unit: "" }];

  it("returns i18n translation when available", () => {
    expect(getSignalTypeLabel("velocity", signalTypes, { velocity: "速度" })).toBe("速度");
  });

  it("falls back to API name when no i18n", () => {
    expect(getSignalTypeLabel("velocity", signalTypes, {})).toBe("Velocity");
  });

  it("falls back to raw type when no API match", () => {
    expect(getSignalTypeLabel("unknown_type", [], {})).toBe("unknown_type");
  });
});

describe("getSignalDisplayName", () => {
  const labels = { risingStar: "Rising Star", suddenSpike: "Sudden Spike" };

  it("returns translated label for known signal type", () => {
    expect(getSignalDisplayName("rising_star", labels)).toBe("Rising Star");
  });

  it("returns formatted type for unknown signal type", () => {
    expect(getSignalDisplayName("custom_signal", labels)).toBe("custom signal");
  });

  it("returns formatted type when key exists but label missing", () => {
    expect(getSignalDisplayName("breakout", {})).toBe("breakout");
  });
});
