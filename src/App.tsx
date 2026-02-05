/**
 * StarScope - GitHub Project Intelligence
 * Main application entry point with theme and i18n support.
 */

import { useState, lazy, Suspense, useMemo } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppHeader } from "./components/AppHeader";
import { I18nContext } from "./i18n";
import { ThemeContext } from "./theme";
import { useAppTheme } from "./hooks/useAppTheme";
import { useAppLanguage } from "./hooks/useAppLanguage";
import "./App.css";

// Lazy load pages for code splitting
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Discovery = lazy(() => import("./pages/Discovery").then((m) => ({ default: m.Discovery })));
const Watchlist = lazy(() => import("./pages/Watchlist").then((m) => ({ default: m.Watchlist })));
const Trends = lazy(() => import("./pages/Trends").then((m) => ({ default: m.Trends })));
const Signals = lazy(() => import("./pages/Signals").then((m) => ({ default: m.Signals })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));

type Page = "dashboard" | "discovery" | "watchlist" | "trends" | "signals" | "settings";

/** Loading fallback component */
function PageLoader({ text }: { text?: string }) {
  return (
    <div className="page-loader">
      <div className="loader-spinner" />
      <p>{text || "Loading..."}</p>
    </div>
  );
}

/** Page router component */
function PageContent({ page }: { page: Page }) {
  switch (page) {
    case "dashboard":
      return <Dashboard />;
    case "discovery":
      return <Discovery />;
    case "watchlist":
      return <Watchlist />;
    case "trends":
      return <Trends />;
    case "signals":
      return <Signals />;
    case "settings":
      return <Settings />;
  }
}

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const { theme, setTheme, toggleTheme } = useAppTheme();
  const { language, setLanguage, toggleLanguage, t } = useAppLanguage();

  // Memoize context values to prevent unnecessary re-renders
  const themeContextValue = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme]
  );

  const i18nContextValue = useMemo(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t]
  );

  return (
    <ThemeContext.Provider value={themeContextValue}>
      <I18nContext.Provider value={i18nContextValue}>
        <div className="app">
          <AppHeader
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            theme={theme}
            onThemeToggle={toggleTheme}
            language={language}
            onLanguageToggle={toggleLanguage}
            t={t}
          />

          <main className="app-main">
            <ErrorBoundary>
              <Suspense fallback={<PageLoader text={t.common.loading} />}>
                <PageContent page={currentPage} />
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </I18nContext.Provider>
    </ThemeContext.Provider>
  );
}

export default App;
