/**
 * 應用程式 header，含導覽列、主題切換、語言切換與通知中心。
 */

import { useMemo } from "react";
import type { ReactNode } from "react";
import {
  StarIcon,
  SearchIcon,
  RepoIcon,
  GraphIcon,
  GitCompareIcon,
  GearIcon,
  SunIcon,
  MoonIcon,
  GlobeIcon,
  HomeIcon,
} from "./Icons";
import { NotificationCenter } from "./NotificationCenter";
import type { Theme } from "../theme";
import type { Language, TranslationKeys } from "../i18n";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import type { Page } from "../types/navigation";

interface NavItem {
  id: Page;
  label: string;
  icon: ReactNode;
}

interface AppHeaderProps {
  currentPage: Page;
  onPageChange: (page: Page) => void;
  theme: Theme;
  onThemeToggle: () => void;
  language: Language;
  onLanguageToggle: () => void;
  t: TranslationKeys;
}

function buildNavItems(t: TranslationKeys, iconSize: number, includeSettings = false): NavItem[] {
  const items: NavItem[] = [
    { id: "dashboard", label: t.nav.dashboard, icon: <HomeIcon size={iconSize} /> },
    { id: "discovery", label: t.nav.discovery, icon: <SearchIcon size={iconSize} /> },
    { id: "watchlist", label: t.nav.watchlist, icon: <RepoIcon size={iconSize} /> },
    { id: "trends", label: t.nav.trends, icon: <GraphIcon size={iconSize} /> },
    { id: "compare", label: t.nav.compare, icon: <GitCompareIcon size={iconSize} /> },
  ];
  if (includeSettings) {
    items.push({ id: "settings", label: t.nav.settings, icon: <GearIcon size={iconSize} /> });
  }
  return items;
}

export function AppHeader({
  currentPage,
  onPageChange,
  theme,
  onThemeToggle,
  language,
  onLanguageToggle,
  t,
}: AppHeaderProps) {
  const navItems = useMemo(() => buildNavItems(t, 16), [t]);
  const mobileNavItems = useMemo(() => buildNavItems(t, 20, true), [t]);
  const isDark = theme === "dark";
  const isEnglish = language === "en";
  const isOnline = useOnlineStatus();

  const themeTitle = isDark
    ? t.settings.appearance.switchToLight
    : t.settings.appearance.switchToDark;
  const langTitle = t.settings.appearance.switchLanguage;

  return (
    <>
      {/* RustRover 會對下面這行報「Cannot resolve anchor #main-content」——那是誤報：
          目標是 App.tsx 的 <main id="main-content">，IDE 只在單一檔案內解析錨點，
          跨元件組合追不到。實測（headed 瀏覽器）Tab→Enter 後焦點導覽起點確實移到 main。

          註解形式的抑制在這裡無效：noinspection 與 suppress 兩種都試過，警告照樣出現。
          真要消掉只能在 IDE 端關掉 HtmlUnknownAnchorTarget（.idea 不進版控，屬個人設定）。
          這條鏈結的正確性由 e2e/skip-link.spec.ts 保證，不是靠註解 */}
      <a className="skip-to-content" href="#main-content">
        {t.common.skipToContent}
      </a>
      <header className="app-header">
        <nav className="nav-container" aria-label={t.nav.mainNavigation}>
          {/* 左側：Logo 與導覽 */}
          <div className="nav-left">
            <button className="nav-logo" onClick={() => onPageChange("dashboard")}>
              <StarIcon size={32} className="logo-icon" />
              <span className="logo-text">StarScope</span>
            </button>

            <div className="nav-items">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  data-testid={`nav-${item.id}`}
                  className={`nav-item ${currentPage === item.id ? "active" : ""}`}
                  onClick={() => onPageChange(item.id)}
                  aria-current={currentPage === item.id ? "page" : undefined}
                  aria-label={item.label}
                >
                  <span className="nav-item-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="nav-item-label">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 右側：通知、主題、語言、設定 */}
          <div className="nav-right">
            {/* 離線指示器 */}
            {!isOnline && (
              <span className="offline-indicator" role="status">
                ⚠ {t.common.offline}
              </span>
            )}

            {/* 通知 */}
            <NotificationCenter onNavigate={onPageChange} />

            {/* 語言切換 */}
            <button
              data-testid="lang-toggle"
              className="nav-action-btn"
              onClick={onLanguageToggle}
              title={langTitle}
              aria-label={langTitle}
            >
              <GlobeIcon size={16} aria-hidden="true" />
              <span className="nav-action-label">{isEnglish ? "EN" : "中"}</span>
            </button>

            {/* 主題切換 */}
            <button
              data-testid="theme-toggle"
              className="nav-action-btn"
              onClick={onThemeToggle}
              title={themeTitle}
              aria-label={themeTitle}
            >
              {isDark ? (
                <SunIcon size={16} aria-hidden="true" />
              ) : (
                <MoonIcon size={16} aria-hidden="true" />
              )}
            </button>

            {/* 設定 */}
            <button
              data-testid="nav-settings"
              className={`nav-action-btn ${currentPage === "settings" ? "active" : ""}`}
              onClick={() => onPageChange("settings")}
              title={t.nav.settings}
              aria-label={t.nav.settings}
              aria-current={currentPage === "settings" ? "page" : undefined}
            >
              <GearIcon size={16} aria-hidden="true" />
            </button>
          </div>
        </nav>
      </header>

      {/* 手機底部 tab bar，僅在 ≤768px 時透過 CSS 顯示 */}
      <nav className="mobile-tab-bar" aria-label={t.nav.mobileNavigation}>
        {mobileNavItems.map((item) => (
          <button
            key={item.id}
            className={`mobile-tab-item ${currentPage === item.id ? "active" : ""}`}
            onClick={() => onPageChange(item.id)}
            aria-current={currentPage === item.id ? "page" : undefined}
            aria-label={item.label}
          >
            <span className="mobile-tab-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="mobile-tab-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
