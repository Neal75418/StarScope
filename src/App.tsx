/**
 * StarScope - GitHub Project Intelligence
 * Main application entry point.
 */

import { useState, lazy, Suspense } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./App.css";

// Lazy load pages for code splitting - reduces initial bundle size
const Watchlist = lazy(() => import("./pages/Watchlist").then(m => ({ default: m.Watchlist })));
const Trends = lazy(() => import("./pages/Trends").then(m => ({ default: m.Trends })));
const Compare = lazy(() => import("./pages/Compare").then(m => ({ default: m.Compare })));
const Signals = lazy(() => import("./pages/Signals").then(m => ({ default: m.Signals })));
const Settings = lazy(() => import("./pages/Settings").then(m => ({ default: m.Settings })));

type Page = "watchlist" | "trends" | "compare" | "signals" | "settings";

/** Loading fallback component for Suspense */
function PageLoader() {
  return (
    <div className="page-loader">
      <div className="loader-spinner" />
      <p>Loading...</p>
    </div>
  );
}

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("watchlist");

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

  return (
    <div className="app">
      <nav className="nav-bar">
        <div className="nav-brand">StarScope</div>
        <div className="nav-links">
          <button
            className={`nav-link ${currentPage === "watchlist" ? "active" : ""}`}
            onClick={() => setCurrentPage("watchlist")}
          >
            Watchlist
          </button>
          <button
            className={`nav-link ${currentPage === "trends" ? "active" : ""}`}
            onClick={() => setCurrentPage("trends")}
          >
            Trends
          </button>
          <button
            className={`nav-link ${currentPage === "compare" ? "active" : ""}`}
            onClick={() => setCurrentPage("compare")}
          >
            Compare
          </button>
          <button
            className={`nav-link ${currentPage === "signals" ? "active" : ""}`}
            onClick={() => setCurrentPage("signals")}
          >
            Signals
          </button>
          <button
            className={`nav-link ${currentPage === "settings" ? "active" : ""}`}
            onClick={() => setCurrentPage("settings")}
          >
            Settings
          </button>
        </div>
      </nav>

      <main className="main-content">
        <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            {renderPage()}
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default App;
