/**
 * Global i18n mock for tests.
 * Uses actual English translations to provide realistic test data.
 * Individual tests can override with vi.mock if needed.
 */

import { translations } from "../i18n/translations";

export function createI18nMock(setLanguageFn: () => void = () => {}) {
  return {
    useI18n: () => ({
      t: translations.en,
      language: "en" as const,
      setLanguage: setLanguageFn,
    }),
    interpolate: (str: string, vars: Record<string, string | number>) =>
      str.replace(/{(\w+)}/g, (_, key: string) => String(vars[key] ?? `{${key}}`)),
    getTranslations: (lang: string) =>
      translations[lang as keyof typeof translations],
    getInitialLanguage: () => "en" as const,
    saveLanguage: () => {},
    translations,
    I18nContext: null,
  };
}
