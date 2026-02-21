/**
 * StarScope — GitHub 專案情報分析。
 * 應用程式主入口，含主題與 i18n 支援。
 */

import { useState, lazy, Suspense, useMemo } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppHeader } from "./components/AppHeader";
import { I18nContext } from "./i18n";
import { ThemeContext } from "./theme";
import { useAppTheme } from "./hooks/useAppTheme";
import { useAppLanguage } from "./hooks/useAppLanguage";
import { WatchlistProvider } from "./contexts/WatchlistContext";
import { queryClient } from "./lib/react-query";
import type { Page } from "./types/navigation";
import "./App.css";

// 延遲載入頁面以進行 code splitting
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Discovery = lazy(() => import("./pages/Discovery").then((m) => ({ default: m.Discovery })));
const Watchlist = lazy(() => import("./pages/Watchlist").then((m) => ({ default: m.Watchlist })));
const Trends = lazy(() => import("./pages/Trends").then((m) => ({ default: m.Trends })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));

/** 載入中的 fallback 元件 */
function PageLoader({ text }: { text?: string }) {
  return (
    <div className="page-loader">
      <div className="loader-spinner" />
      <p>{text || "Loading..."}</p>
    </div>
  );
}

/** 頁面路由元件 */
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
    case "settings":
      return <Settings />;
  }
}

function App() {
  const [currentPage, setCurrentPage] = useState<Page>(() => {
    const saved = localStorage.getItem("starscope-page");
    const validPages: Page[] = ["dashboard", "discovery", "watchlist", "trends", "settings"];
    return saved && validPages.includes(saved as Page) ? (saved as Page) : "dashboard";
  });

  const handlePageChange = (page: Page) => {
    setCurrentPage(page);
    localStorage.setItem("starscope-page", page);
  };
  const { theme, setTheme, toggleTheme } = useAppTheme();
  const { language, setLanguage, toggleLanguage, t } = useAppLanguage();

  // 記憶化 context 值以避免不必要的重新渲染
  const themeContextValue = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme]
  );

  const i18nContextValue = useMemo(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t]
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeContext.Provider value={themeContextValue}>
        <I18nContext.Provider value={i18nContextValue}>
          <WatchlistProvider>
            <div className="app">
              <AppHeader
                currentPage={currentPage}
                onPageChange={handlePageChange}
                theme={theme}
                onThemeToggle={toggleTheme}
                language={language}
                onLanguageToggle={toggleLanguage}
                t={t}
              />

              <main className="app-main" id="main-content">
                <ErrorBoundary>
                  <Suspense fallback={<PageLoader text={t.common.loading} />}>
                    <PageContent page={currentPage} />
                  </Suspense>
                </ErrorBoundary>
              </main>
            </div>
          </WatchlistProvider>
        </I18nContext.Provider>
      </ThemeContext.Provider>
    </QueryClientProvider>
  );
}

export default App;
