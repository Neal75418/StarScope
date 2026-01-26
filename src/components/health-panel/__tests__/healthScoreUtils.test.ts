import { describe, it, expect } from "vitest";
import {
  getScoreColor,
  formatResponseTime,
  formatDate,
  TimeTranslations,
} from "../healthScoreUtils";

describe("healthScoreUtils", () => {
  describe("getScoreColor", () => {
    it("returns gray for null score", () => {
      expect(getScoreColor(null)).toBe("var(--gray-400)");
    });

    it("returns success color for score >= 80", () => {
      expect(getScoreColor(80)).toBe("var(--success-color)");
      expect(getScoreColor(100)).toBe("var(--success-color)");
      expect(getScoreColor(95)).toBe("var(--success-color)");
    });

    it("returns warning color for score >= 60 and < 80", () => {
      expect(getScoreColor(60)).toBe("var(--warning-color)");
      expect(getScoreColor(79)).toBe("var(--warning-color)");
      expect(getScoreColor(70)).toBe("var(--warning-color)");
    });

    it("returns danger color for score < 60", () => {
      expect(getScoreColor(59)).toBe("var(--danger-color)");
      expect(getScoreColor(0)).toBe("var(--danger-color)");
      expect(getScoreColor(30)).toBe("var(--danger-color)");
    });
  });

  describe("formatResponseTime", () => {
    const timeT: TimeTranslations = {
      na: "N/A",
      hours: "{value} hours",
      days: "{value} days",
      weeks: "{value} weeks",
    };

    it("returns N/A for null hours", () => {
      expect(formatResponseTime(null, timeT)).toBe("N/A");
    });

    it("formats hours when < 24", () => {
      expect(formatResponseTime(12, timeT)).toBe("12.0 hours");
      expect(formatResponseTime(1, timeT)).toBe("1.0 hours");
      expect(formatResponseTime(23.5, timeT)).toBe("23.5 hours");
    });

    it("formats days when >= 24 hours and < 7 days", () => {
      expect(formatResponseTime(24, timeT)).toBe("1.0 days");
      expect(formatResponseTime(48, timeT)).toBe("2.0 days");
      expect(formatResponseTime(144, timeT)).toBe("6.0 days");
    });

    it("formats weeks when >= 7 days", () => {
      expect(formatResponseTime(168, timeT)).toBe("1.0 weeks");
      expect(formatResponseTime(336, timeT)).toBe("2.0 weeks");
      expect(formatResponseTime(504, timeT)).toBe("3.0 weeks");
    });
  });

  describe("formatDate", () => {
    it("formats date string correctly", () => {
      const result = formatDate("2024-01-15T10:30:00Z");
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("handles different date formats", () => {
      const result = formatDate("2024-06-01T00:00:00Z");
      expect(result).toBeTruthy();
    });
  });
});
