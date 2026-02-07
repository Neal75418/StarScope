/**
 * 應用程式掛載入口，將 React 根元件渲染至 DOM。
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
window.onerror = (message, source, lineno, colno, error) => {
  // eslint-disable-next-line no-console
  console.error("Uncaught error:", { message, source, lineno, colno, error });
};
window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  // eslint-disable-next-line no-console
  console.error("Unhandled promise rejection:", event.reason);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
