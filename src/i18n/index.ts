/**
 * Internationalization (i18n) system for StarScope
 */

import { createContext, useContext } from "react";
import { translations, Language, TranslationKeys } from "./translations";

// Storage key for persisting language preference
const LANGUAGE_STORAGE_KEY = "starscope-language";

// Get initial language from localStorage or browser preference
export function getInitialLanguage(): Language {
  // Check localStorage first
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === "en" || stored === "zh-TW") {
    return stored;
  }

  // Fall back to browser language
  const browserLang = navigator.language;
  if (browserLang.startsWith("zh")) {
    return "zh-TW";
  }

  return "en";
}

// Save language preference
export function saveLanguage(lang: Language): void {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
}

// Context for language state
interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationKeys;
}

export const I18nContext = createContext<I18nContextType | null>(null);

// Hook to use translations
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}

// Get translations for a language
export function getTranslations(lang: Language): TranslationKeys {
  return translations[lang];
}

// Helper to interpolate variables in translation strings
export function interpolate(str: string, vars: Record<string, string | number>): string {
  return str.replace(/{(\w+)}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}

export { translations, type Language, type TranslationKeys };
