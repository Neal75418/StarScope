import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration for StarScope
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],

  /* Run local dev server before starting tests */
  webServer: process.env.CI
    ? undefined // Skip webServer in CI - servers are started manually or tests are skipped
    : [
        {
          command: "cd sidecar && .venv/bin/python main.py",
          url: "http://127.0.0.1:8008/api/health",
          reuseExistingServer: true,
          timeout: 60000,
        },
        {
          command: "npm run dev",
          url: "http://localhost:5173",
          reuseExistingServer: true,
          timeout: 30000,
        },
      ],
});
