/**
 * Unit tests for i18n utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Use the real module, not the global mock from setup.ts
vi.unmock("../index");

import { getInitialLanguage, saveLanguage, interpolate, getTranslations } from "../index";

describe("i18n utilities", () => {
  const LANGUAGE_STORAGE_KEY = "starscope-language";

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("getInitialLanguage", () => {
    it("returns stored language from localStorage", () => {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, "zh-TW");
      expect(getInitialLanguage()).toBe("zh-TW");
    });

    it("returns en from localStorage", () => {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
      expect(getInitialLanguage()).toBe("en");
    });

    it("defaults to zh-TW for Chinese browser language", () => {
      Object.defineProperty(navigator, "language", {
        value: "zh-CN",
        configurable: true,
      });
      localStorage.clear();
      expect(getInitialLanguage()).toBe("zh-TW");
    });

    it("defaults to en for non-Chinese browser language", () => {
      Object.defineProperty(navigator, "language", {
        value: "en-US",
        configurable: true,
      });
      localStorage.clear();
      expect(getInitialLanguage()).toBe("en");
    });
  });

  describe("saveLanguage", () => {
    it("saves en to localStorage", () => {
      saveLanguage("en");
      expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
    });

    it("saves zh-TW to localStorage", () => {
      saveLanguage("zh-TW");
      expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("zh-TW");
    });
  });

  describe("interpolate", () => {
    it("replaces single variable", () => {
      const result = interpolate("Hello {name}", { name: "World" });
      expect(result).toBe("Hello World");
    });

    it("replaces multiple variables", () => {
      const result = interpolate("{greeting} {name}!", { greeting: "Hello", name: "Alice" });
      expect(result).toBe("Hello Alice!");
    });

    it("handles number variables", () => {
      const result = interpolate("Score: {score}", { score: 95 });
      expect(result).toBe("Score: 95");
    });

    it("keeps placeholder if variable not provided", () => {
      const result = interpolate("Hello {name}", {});
      expect(result).toBe("Hello {name}");
    });

    it("handles multiple occurrences of same variable", () => {
      const result = interpolate("{name} says {name}", { name: "Bob" });
      expect(result).toBe("Bob says Bob");
    });
  });

  describe("getTranslations", () => {
    it("returns English translations", () => {
      const translations = getTranslations("en");
      expect(translations).toBeDefined();
      expect(translations.common).toBeDefined();
    });

    it("returns Traditional Chinese translations", () => {
      const translations = getTranslations("zh-TW");
      expect(translations).toBeDefined();
      expect(translations.common).toBeDefined();
    });
  });
});
