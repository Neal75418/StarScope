/**
 * StarScope - GitHub Project Intelligence
 * Main application entry point.
 */

import { useState } from "react";
import { Watchlist } from "./pages/Watchlist";
import { Trends } from "./pages/Trends";
import "./App.css";

type Page = "watchlist" | "trends";

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("watchlist");

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
        </div>
      </nav>

      <main className="main-content">
        {currentPage === "watchlist" && <Watchlist />}
        {currentPage === "trends" && <Trends />}
      </main>
    </div>
  );
}

export default App;
