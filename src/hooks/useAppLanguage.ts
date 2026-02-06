/**
 * 語言 / i18n 狀態管理與持久化。
 */

import { useState, useCallback, useMemo } from "react";
import {
  Language,
  getInitialLanguage,
  saveLanguage,
  getTranslations,
  TranslationKeys,
} from "../i18n";

export interface UseAppLanguageReturn {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: TranslationKeys;
}

export function useAppLanguage(): UseAppLanguageReturn {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  const setLanguage = useCallback((newLang: Language) => {
    setLanguageState(newLang);
    saveLanguage(newLang);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((current) => {
      const newLang = current === "en" ? "zh-TW" : "en";
      saveLanguage(newLang);
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
