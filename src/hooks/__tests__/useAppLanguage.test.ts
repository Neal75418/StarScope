import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockGetInitialLanguage = vi.fn();
const mockSaveLanguage = vi.fn();

// Override the global i18n mock for this test file
vi.mock("../../i18n", async () => {
  const { translations } = await import("../../i18n/translations");
  return {
    getInitialLanguage: (...args: unknown[]) => mockGetInitialLanguage(...args),
    saveLanguage: (...args: unknown[]) => mockSaveLanguage(...args),
    getTranslations: (lang: string) => translations[lang as keyof typeof translations],
    translations,
    useI18n: () => ({
      t: translations.en,
      language: "en" as const,
      setLanguage: vi.fn(),
    }),
    interpolate: (str: string, vars: Record<string, string | number>) =>
      str.replace(/{(\w+)}/g, (_, key: string) => String(vars[key] ?? `{${key}}`)),
    I18nContext: null,
  };
});

import { useAppLanguage } from "../useAppLanguage";
import { translations } from "../../i18n/translations";

describe("useAppLanguage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInitialLanguage.mockReturnValue("en");
  });

  it("initializes with language from getInitialLanguage", () => {
    mockGetInitialLanguage.mockReturnValue("zh-TW");

    const { result } = renderHook(() => useAppLanguage());

    expect(result.current.language).toBe("zh-TW");
  });

  it("provides correct translations for current language", () => {
    mockGetInitialLanguage.mockReturnValue("en");

    const { result } = renderHook(() => useAppLanguage());

    expect(result.current.t).toBe(translations.en);
  });

  it("setLanguage updates state and saves", () => {
    const { result } = renderHook(() => useAppLanguage());

    act(() => {
      result.current.setLanguage("zh-TW");
    });

    expect(result.current.language).toBe("zh-TW");
    expect(mockSaveLanguage).toHaveBeenCalledWith("zh-TW");
  });

  it("setLanguage updates translations", () => {
    const { result } = renderHook(() => useAppLanguage());

    act(() => {
      result.current.setLanguage("zh-TW");
    });

    expect(result.current.t).toBe(translations["zh-TW"]);
  });

  it("toggleLanguage switches en to zh-TW", () => {
    mockGetInitialLanguage.mockReturnValue("en");
    const { result } = renderHook(() => useAppLanguage());

    act(() => {
      result.current.toggleLanguage();
    });

    expect(result.current.language).toBe("zh-TW");
    expect(mockSaveLanguage).toHaveBeenCalledWith("zh-TW");
  });

  it("toggleLanguage switches zh-TW to en", () => {
    mockGetInitialLanguage.mockReturnValue("zh-TW");
    const { result } = renderHook(() => useAppLanguage());

    act(() => {
      result.current.toggleLanguage();
    });

    expect(result.current.language).toBe("en");
    expect(mockSaveLanguage).toHaveBeenCalledWith("en");
  });

  it("returns stable references via useMemo", () => {
    const { result, rerender } = renderHook(() => useAppLanguage());

    const first = result.current;
    rerender();
    const second = result.current;

    expect(first.setLanguage).toBe(second.setLanguage);
    expect(first.toggleLanguage).toBe(second.toggleLanguage);
  });
});
