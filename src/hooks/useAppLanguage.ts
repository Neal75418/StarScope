/**
 * 語言 / i18n 狀態管理與持久化。
 */

import { useState, useCallback, useMemo } from "react";
import { getInitialLanguage, saveLanguage, getTranslations } from "../i18n";
import type { Language, TranslationKeys } from "../i18n";

interface UseAppLanguageReturn {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: TranslationKeys;
}

export function useAppLanguage(): UseAppLanguageReturn {
  const [language, setLanguageState] = useState<Language>(() => {
    const initial = getInitialLanguage();
    document.documentElement.lang = initial;
    return initial;
  });

  const setLanguage = useCallback((newLang: Language) => {
    setLanguageState(newLang);
    saveLanguage(newLang);
    document.documentElement.lang = newLang;
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((current) => {
      const newLang = current === "en" ? "zh-TW" : "en";
      saveLanguage(newLang);
      document.documentElement.lang = newLang;
      return newLang;
    });
  }, []);

  const t = getTranslations(language);

  // 記憶化回傳物件，避免消費端無限迴圈
  return useMemo(
    () => ({ language, setLanguage, toggleLanguage, t }),
    [language, setLanguage, toggleLanguage, t]
  );
}
