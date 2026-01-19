/**
 * StarScope - GitHub Project Intelligence
 * Main application entry point with theme and i18n support.
 */

import { useState, useEffect, lazy, Suspense, ReactNode } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  StarIcon,
  RepoIcon,
  GraphIcon,
  PulseIcon,
  GitCompareIcon,
  GearIcon,
  SunIcon,
  MoonIcon,
  GlobeIcon,
} from "./components/Icons";
import { I18nContext, getInitialLanguage, saveLanguage, getTranslations, Language } from "./i18n";
import { ThemeContext, getInitialTheme, saveTheme, applyTheme, Theme } from "./theme";
import "./App.css";

// Lazy load pages for code splitting
const Watchlist = lazy(() => import("./pages/Watchlist").then((m) => ({ default: m.Watchlist })));
const Trends = lazy(() => import("./pages/Trends").then((m) => ({ default: m.Trends })));
const Compare = lazy(() => import("./pages/Compare").then((m) => ({ default: m.Compare })));
const Signals = lazy(() => import("./pages/Signals").then((m) => ({ default: m.Signals })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));

type Page = "watchlist" | "trends" | "compare" | "signals" | "settings";

/** Loading fallback component */
function PageLoader({ text }: { text?: string }) {
  return (
    <div className="page-loader">
      <div className="loader-spinner" />
      <p>{text || "Loading..."}</p>
    </div>
  );
}

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("watchlist");

  // Theme state
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    saveTheme(newTheme);
    applyTheme(newTheme);
  };

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  // Apply theme on mount and when theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Language state
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  const setLanguage = (newLang: Language) => {
    setLanguageState(newLang);
    saveLanguage(newLang);
  };

  const t = getTranslations(language);

  const toggleLanguage = () => {
    setLanguage(language === "en" ? "zh-TW" : "en");
  };

  const renderPage = () => {
    switch (currentPage) {
      case "watchlist":
        return <Watchlist />;
      case "trends":
        return <Trends />;
      case "compare":
        return <Compare />;
      case "signals":
        return <Signals />;
      case "settings":
        return <Settings />;
    }
  };

  const navItems: { id: Page; label: string; icon: ReactNode }[] = [
    { id: "watchlist", label: t.nav.watchlist, icon: <RepoIcon size={16} /> },
    { id: "trends", label: t.nav.trends, icon: <GraphIcon size={16} /> },
    { id: "signals", label: t.nav.signals, icon: <PulseIcon size={16} /> },
    { id: "compare", label: t.nav.compare, icon: <GitCompareIcon size={16} /> },
  ];

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      <I18nContext.Provider value={{ language, setLanguage, t }}>
        <div className="app">
          {/* GitHub-style Navigation */}
          <header className="app-header">
            <nav className="nav-container">
              {/* Left: Logo and Navigation */}
              <div className="nav-left">
                <a
                  href="#"
                  className="nav-logo"
                  onClick={(e) => {
                    e.preventDefault();
                    setCurrentPage("watchlist");
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
                      onClick={() => setCurrentPage(item.id)}
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

              {/* Right: Theme, Language, Settings */}
              <div className="nav-right">
                {/* Language Toggle */}
                <button
                  data-testid="lang-toggle"
                  className="nav-action-btn"
                  onClick={toggleLanguage}
                  title={language === "en" ? "切換為繁體中文" : "Switch to English"}
                  aria-label={language === "en" ? "切換為繁體中文" : "Switch to English"}
                >
                  <GlobeIcon size={16} aria-hidden="true" />
                  <span className="nav-action-label">{language === "en" ? "EN" : "中"}</span>
                </button>

                {/* Theme Toggle */}
                <button
                  data-testid="theme-toggle"
                  className="nav-action-btn"
                  onClick={toggleTheme}
                  title={
                    theme === "dark"
                      ? t.settings.appearance.switchToLight
                      : t.settings.appearance.switchToDark
                  }
                  aria-label={
                    theme === "dark"
                      ? t.settings.appearance.switchToLight
                      : t.settings.appearance.switchToDark
                  }
                >
                  {theme === "dark" ? (
                    <SunIcon size={16} aria-hidden="true" />
                  ) : (
                    <MoonIcon size={16} aria-hidden="true" />
                  )}
                </button>

                {/* Settings */}
                <button
                  data-testid="nav-settings"
                  className={`nav-action-btn ${currentPage === "settings" ? "active" : ""}`}
                  onClick={() => setCurrentPage("settings")}
                  title={t.nav.settings}
                  aria-label={t.nav.settings}
                  aria-current={currentPage === "settings" ? "page" : undefined}
                >
                  <GearIcon size={16} aria-hidden="true" />
                </button>
              </div>
            </nav>
          </header>

          {/* Main Content */}
          <main className="app-main">
            <ErrorBoundary>
              <Suspense fallback={<PageLoader text={t.common.loading} />}>{renderPage()}</Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </I18nContext.Provider>
    </ThemeContext.Provider>
  );
}

export default App;
