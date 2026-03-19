/**
 * 外觀設定區塊。
 * 提供主題（深色/淺色）與語言（EN/繁中）的切換介面。
 */

import { useContext } from "react";
import { useI18n } from "../../i18n";
import { ThemeContext } from "../../theme";
import type { Theme } from "../../theme";

export function AppearanceSection() {
  const { t, language, setLanguage } = useI18n();
  const themeCtx = useContext(ThemeContext);

  if (!themeCtx) return null;
  const { theme, setTheme } = themeCtx;

  const themes: { value: Theme; label: string }[] = [
    { value: "dark", label: t.settings.appearance.dark },
    { value: "light", label: t.settings.appearance.light },
  ];

  return (
    <section className="settings-section" data-testid="appearance-section">
      <h2>{t.settings.appearance.title}</h2>

      {/* 主題 */}
      <div className="settings-field">
        <label className="settings-field-label">{t.settings.appearance.theme}</label>
        <div className="settings-radio-group">
          {themes.map((opt) => (
            <label key={opt.value} className="radio-option">
              <input
                type="radio"
                name="theme"
                value={opt.value}
                checked={theme === opt.value}
                onChange={() => setTheme(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* 語言 */}
      <div className="settings-field">
        <label className="settings-field-label">{t.settings.appearance.language}</label>
        <div className="settings-radio-group">
          <label className="radio-option">
            <input
              type="radio"
              name="language"
              value="en"
              checked={language === "en"}
              onChange={() => setLanguage("en")}
            />
            {t.settings.appearance.english}
          </label>
          <label className="radio-option">
            <input
              type="radio"
              name="language"
              value="zh-TW"
              checked={language === "zh-TW"}
              onChange={() => setLanguage("zh-TW")}
            />
            {t.settings.appearance.chinese}
          </label>
        </div>
      </div>
    </section>
  );
}
