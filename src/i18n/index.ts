/**
 * StarScope 國際化（i18n）系統。
 */

import { createContext, useContext } from "react";
import { translations, Language, TranslationKeys } from "./translations";

// 儲存語言偏好的 localStorage key
const LANGUAGE_STORAGE_KEY = "starscope-language";

// 從 localStorage 或瀏覽器偏好取得初始語言
export function getInitialLanguage(): Language {
  // 優先檢查 localStorage
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === "en" || stored === "zh-TW") {
    return stored;
  }

  // 退回使用瀏覽器語言
  const browserLang = navigator.language;
  if (browserLang.startsWith("zh")) {
    return "zh-TW";
  }

  return "en";
}

// 儲存語言偏好
export function saveLanguage(lang: Language): void {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
}

// 語言狀態的 Context
interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationKeys;
}

export const I18nContext = createContext<I18nContextType | null>(null);

// 使用翻譯的 Hook
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}

// 取得指定語言的翻譯
export function getTranslations(lang: Language): TranslationKeys {
  return translations[lang];
}

// 在翻譯字串中插入變數的輔助函式
export function interpolate(str: string, vars: Record<string, string | number>): string {
  return str.replace(/{(\w+)}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}

export { translations, type Language, type TranslationKeys };
