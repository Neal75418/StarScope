import { describe, it, expect } from "vitest";
import { getLanguageColor, lookupLanguageColor } from "../languageColors";

describe("getLanguageColor", () => {
  it("returns bg color for known language", () => {
    expect(getLanguageColor("Python")).toBe("#3572A5");
  });

  it("returns default bg color for unknown language", () => {
    expect(getLanguageColor("FakeLang")).toBe("#6b7280");
  });
});

describe("lookupLanguageColor", () => {
  it("returns the same bg as getLanguageColor for known languages", () => {
    expect(lookupLanguageColor("JavaScript")).toBe(getLanguageColor("JavaScript"));
  });

  it("returns undefined for unknown language so callers can pick their own fallback", () => {
    expect(lookupLanguageColor("FakeLang")).toBeUndefined();
  });
});
