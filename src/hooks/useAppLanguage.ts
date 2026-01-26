/**
 * Custom hook for language/i18n management.
 * Encapsulates language state and persistence.
 */

import { useState, useCallback, useMemo } from "react";
import { Language, getInitialLanguage, saveLanguage, getTranslations, TranslationKeys } from "../i18n";

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

  // Memoize return object to prevent infinite loops in consumers
  return useMemo(
    () => ({ language, setLanguage, toggleLanguage, t }),
    [language, setLanguage, toggleLanguage, t]
  );
}
