import { describe, it, expect } from "vitest";
import { getLanguageColors, getLanguageColor } from "../languageColors";

describe("getLanguageColors", () => {
  it("returns correct colors for known language", () => {
    const colors = getLanguageColors("TypeScript");
    expect(colors.bg).toBe("#3178c6");
    expect(colors.text).toBe("#ffffff");
  });

  it("returns default colors for unknown language", () => {
    const colors = getLanguageColors("UnknownLang");
    expect(colors.bg).toBe("#6b7280");
    expect(colors.text).toBe("#f3f4f6");
  });
});

describe("getLanguageColor", () => {
  it("returns bg color for known language", () => {
    expect(getLanguageColor("Python")).toBe("#3572A5");
  });

  it("returns default bg color for unknown language", () => {
    expect(getLanguageColor("FakeLang")).toBe("#6b7280");
  });
});
