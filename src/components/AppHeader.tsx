/**
 * Application header with navigation, theme toggle, language toggle, and notifications.
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

type Page = "dashboard" | "discovery" | "watchlist" | "trends" | "settings";

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
  const isDark = theme === "dark";
  const isEnglish = language === "en";

  const themeTitle = isDark
    ? t.settings.appearance.switchToLight
    : t.settings.appearance.switchToDark;
  const langTitle = isEnglish ? "切換為繁體中文" : "Switch to English";

  return (
    <header className="app-header">
      <nav className="nav-container">
        {/* Left: Logo and Navigation */}
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

        {/* Right: Notifications, Theme, Language, Settings */}
        <div className="nav-right">
          {/* Notifications */}
          <NotificationCenter onNavigate={onPageChange} />

          {/* Language Toggle */}
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

          {/* Theme Toggle */}
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

          {/* Settings */}
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
  );
}
