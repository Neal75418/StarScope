/**
 * 應用程式 header，含導覽列、主題切換、語言切換與通知中心。
 */

import { ReactNode } from "react";
import {
  StarIcon,
  SearchIcon,
  RepoIcon,
  GraphIcon,
  GearIcon,
  SunIcon,
  MoonIcon,
  GlobeIcon,
  HomeIcon,
} from "./Icons";
import { NotificationCenter } from "./NotificationCenter";
import { Theme } from "../theme";
import { Language, TranslationKeys } from "../i18n";
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

function buildNavItems(t: TranslationKeys): NavItem[] {
  return [
    { id: "dashboard", label: t.nav.dashboard, icon: <HomeIcon size={16} /> },
    { id: "discovery", label: t.nav.discovery, icon: <SearchIcon size={16} /> },
    { id: "watchlist", label: t.nav.watchlist, icon: <RepoIcon size={16} /> },
    { id: "trends", label: t.nav.trends, icon: <GraphIcon size={16} /> },
  ];
}

function buildMobileNavItems(t: TranslationKeys): NavItem[] {
  return [
    { id: "dashboard", label: t.nav.dashboard, icon: <HomeIcon size={20} /> },
    { id: "discovery", label: t.nav.discovery, icon: <SearchIcon size={20} /> },
    { id: "watchlist", label: t.nav.watchlist, icon: <RepoIcon size={20} /> },
    { id: "trends", label: t.nav.trends, icon: <GraphIcon size={20} /> },
    { id: "settings", label: t.nav.settings, icon: <GearIcon size={20} /> },
  ];
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
  const navItems = buildNavItems(t);
  const mobileNavItems = buildMobileNavItems(t);
  const isDark = theme === "dark";
  const isEnglish = language === "en";
  const isOnline = useOnlineStatus();

  const themeTitle = isDark
    ? t.settings.appearance.switchToLight
    : t.settings.appearance.switchToDark;
  const langTitle = isEnglish ? "切換為繁體中文" : "Switch to English";

  return (
    <>
      <a className="skip-to-content" href="#main-content">
        {t.common.skipToContent}
      </a>
      <header className="app-header">
        <nav className="nav-container">
          {/* 左側：Logo 與導覽 */}
          <div className="nav-left">
            <a
              href="#"
              className="nav-logo"
              onClick={(e) => {
                e.preventDefault();
                onPageChange("dashboard");
              }}
            >
              <StarIcon size={32} className="logo-icon" />
              <span className="logo-text">StarScope</span>
            </a>

            <div className="nav-items" role="navigation" aria-label="Main navigation">
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
      <nav className="mobile-tab-bar" aria-label="Mobile navigation">
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
