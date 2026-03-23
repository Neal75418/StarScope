import { describe, it, expect } from "vitest";
import { getLanguageColor } from "../languageColors";

describe("getLanguageColor", () => {
  it("returns bg color for known language", () => {
    expect(getLanguageColor("Python")).toBe("#3572A5");
  });

  it("returns default bg color for unknown language", () => {
    expect(getLanguageColor("FakeLang")).toBe("#6b7280");
  });
});
