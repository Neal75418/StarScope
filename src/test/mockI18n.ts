/**
 * Global i18n mock for tests.
 * Uses actual English translations to provide realistic test data.
 * Individual tests can override with vi.mock if needed.
 */

// Import directly from translations module, NOT the barrel (../i18n).
// The barrel is globally mocked by setup.ts, and that mock's factory imports
// THIS file — going through the barrel here makes the factory wait on itself.
// 實測：完整套件正常是 ~10s，改成 "../i18n" 後跑滿 3 分鐘零輸出、必須手動中止。
// 但單獨跑「沒 import i18n 的測試檔」會通過（mock factory 根本沒被觸發），
// 所以拿單一檔案驗這件事會得到錯的結論。
// IDE 的「Import can be shortened」在這裡是誤報。
// noinspection ES6PreferShortImport
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
    getTranslations: (lang: string) => translations[lang as keyof typeof translations],
    getInitialLanguage: () => "en" as const,
    saveLanguage: () => {},
    translations,
    I18nContext: null,
  };
}
