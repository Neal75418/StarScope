import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildCombinedQuery, getStartDateForPeriod, getMinStarsForPeriod } from "../searchHelpers";

describe("searchHelpers", () => {
  describe("buildCombinedQuery", () => {
    it("returns keyword only when no period or language", () => {
      expect(buildCombinedQuery("react", undefined, undefined)).toBe("react");
    });

    it("returns empty string for empty keyword and no filters", () => {
      expect(buildCombinedQuery("", undefined, undefined)).toBe("");
    });

    it("includes period-based date and stars filters", () => {
      const result = buildCombinedQuery("react", "weekly", undefined);
      expect(result).toContain("react");
      expect(result).toContain("created:>");
      expect(result).toContain("stars:>=50");
    });

    it("includes language filter", () => {
      const result = buildCombinedQuery("react", undefined, "TypeScript");
      expect(result).toContain("react");
      expect(result).toContain("language:TypeScript");
    });

    it("combines all filters", () => {
      const result = buildCombinedQuery("web", "daily", "JavaScript");
      expect(result).toContain("web");
      expect(result).toContain("created:>");
      expect(result).toContain("stars:>=10");
      expect(result).toContain("language:JavaScript");
    });

    it("trims keyword whitespace", () => {
      expect(buildCombinedQuery("  ", undefined, undefined)).toBe("");
    });
  });

  describe("getStartDateForPeriod", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns yesterday for daily", () => {
      expect(getStartDateForPeriod("daily")).toBe("2024-06-14");
    });

    it("returns 7 days ago for weekly", () => {
      expect(getStartDateForPeriod("weekly")).toBe("2024-06-08");
    });

    it("returns 30 days ago for monthly", () => {
      expect(getStartDateForPeriod("monthly")).toBe("2024-05-16");
    });
  });

  describe("getMinStarsForPeriod", () => {
    it("returns 10 for daily", () => {
      expect(getMinStarsForPeriod("daily")).toBe(10);
    });

    it("returns 50 for weekly", () => {
      expect(getMinStarsForPeriod("weekly")).toBe(50);
    });

    it("returns 100 for monthly", () => {
      expect(getMinStarsForPeriod("monthly")).toBe(100);
    });
  });
});
