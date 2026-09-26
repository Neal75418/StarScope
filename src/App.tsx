/**
 * StarScope — GitHub 專案情報分析。
 * 應用程式主入口，含主題與 i18n 支援。
 */

import { useState, useCallback, lazy, Suspense, useMemo } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppHeader } from "./components/AppHeader";
import { I18nContext, useI18n } from "./i18n";
import { ThemeContext } from "./theme";
import { useAppTheme } from "./hooks/useAppTheme";
import { useAppLanguage } from "./hooks/useAppLanguage";
import { useStartupPage } from "./hooks/useStartupPage";
import { WatchlistProvider } from "./contexts/WatchlistContext";
import { NavigationProvider } from "./contexts/NavigationContext";
import { AppStatusProvider } from "./contexts/AppStatusContext";
import { StatusBanner } from "./components/StatusBanner";
import { probeSidecarNow, useSidecarEverUp, useSidecarPhase } from "./api/sidecarConnection";
import { queryClient } from "./lib/react-query";
import type { Page } from "./types/navigation";
import { STORAGE_KEYS } from "./constants/storage";
import "./App.css";

// 延遲載入頁面以進行 code splitting
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Discovery = lazy(() => import("./pages/Discovery").then((m) => ({ default: m.Discovery })));
const Watchlist = lazy(() => import("./pages/Watchlist").then((m) => ({ default: m.Watchlist })));
const Trends = lazy(() => import("./pages/Trends").then((m) => ({ default: m.Trends })));
const Compare = lazy(() => import("./pages/Compare").then((m) => ({ default: m.Compare })));
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

/**
 * 這次開 app 一直連不上 sidecar：不掛頁面（頁面會以為沒有資料），直接說引擎沒在跑。
 * 探測仍在背景每 FAST_PROBE_MS 重試，連上後自動換成頁面；按鈕只是不必等下一輪。
 */
function SidecarUnavailable() {
  const { t } = useI18n();
  return (
    <div className="page" data-testid="sidecar-unavailable">
      {/* 不設 role="alert"：StatusBanner 同時以同一句話宣讀，兩個 alert 會念兩次 */}
      <div className="error-container">
        <h2>{t.status.sidecarDown}</h2>
        <p className="hint">{t.watchlist.connection.autoRetry}</p>
        <button onClick={probeSidecarNow} className="btn btn-primary">
          {t.watchlist.connection.retry}
        </button>
      </div>
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
    case "compare":
      return <Compare />;
    case "settings":
      return <Settings />;
  }
}

function readSavedPage(): Page {
  const saved = localStorage.getItem(STORAGE_KEYS.PAGE);
  const validPages: Page[] = [
    "dashboard",
    "discovery",
    "watchlist",
    "trends",
    "compare",
    "settings",
  ];
  return saved && validPages.includes(saved as Page) ? (saved as Page) : "dashboard";
}

export function App() {
  const [savedPage] = useState(readSavedPage);
  // 有「自上次以來」的重點時啟動落在 Dashboard；決定之前是 null（見 useStartupPage）
  const startupPage = useStartupPage(savedPage);
  const [chosenPage, setChosenPage] = useState<Page | null>(null);
  const currentPage = chosenPage ?? startupPage;
  // 這次開 app 還沒連上過 sidecar 就先不渲染頁面：查詢暫停中、還沒有資料時 isLoading 是 false，
  // 頁面會畫出「還沒追蹤任何專案」之類的空狀態（見 api/sidecarConnection.ts）。
  // 啟動中顯示載入；過了啟動時間仍連不上，說引擎沒在跑。連上過之後才中途斷線的話照常顯示頁面
  const sidecarPhase = useSidecarPhase();
  const sidecarEverUp = useSidecarEverUp();

  const handlePageChange = useCallback((page: Page) => {
    setChosenPage(page);
    try {
      localStorage.setItem(STORAGE_KEYS.PAGE, page);
    } catch {
      // QuotaExceededError — 靜默忽略，不影響導航功能
    }
  }, []);
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
          <AppStatusProvider>
            <WatchlistProvider>
              <NavigationProvider onPageChange={handlePageChange}>
                <div className="app">
                  <AppHeader
                    currentPage={currentPage ?? savedPage}
                    onPageChange={handlePageChange}
                    theme={theme}
                    onThemeToggle={toggleTheme}
                    language={language}
                    onLanguageToggle={toggleLanguage}
                    t={t}
                  />

                  <StatusBanner />
                  <main className="app-main" id="main-content">
                    <ErrorBoundary>
                      <Suspense fallback={<PageLoader text={t.common.loading} />}>
                        {!sidecarEverUp && sidecarPhase === "down" ? (
                          <SidecarUnavailable />
                        ) : currentPage && sidecarEverUp ? (
                          <PageContent page={currentPage} />
                        ) : (
                          <PageLoader text={t.common.loading} />
                        )}
                      </Suspense>
                    </ErrorBoundary>
                  </main>
                </div>
              </NavigationProvider>
            </WatchlistProvider>
          </AppStatusProvider>
        </I18nContext.Provider>
      </ThemeContext.Provider>
    </QueryClientProvider>
  );
}
