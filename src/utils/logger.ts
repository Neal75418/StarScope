/**
 * 輕量級 logger，僅在開發模式輸出至 console。
 * 生產環境下為 no-op，避免洩漏內部訊息。
 */

/* eslint-disable no-console */

function log(level: "error" | "warn" | "info", message: string, error?: unknown): void {
  if (!import.meta.env.DEV) return;
  if (error !== undefined) {
    console[level](message, error);
  } else {
    console[level](message);
  }
}

export const logger = {
  error: (message: string, error?: unknown) => log("error", message, error),
  warn: (message: string, error?: unknown) => log("warn", message, error),
  info: (message: string) => log("info", message),
};
