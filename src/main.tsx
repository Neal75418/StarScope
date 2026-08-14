/**
 * 應用程式掛載入口，將 React 根元件渲染至 DOM。
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
// 全域 uncaught handler 刻意用裸 console 而非 utils/logger：
// logger 在生產環境是 no-op，這裡是最後的診斷出口，不能被吞掉。
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
