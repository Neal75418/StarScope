import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration for StarScope
 * @see https://playwright.dev/docs/test-configuration
 */
/** 會寫入共用狀態（DB / 伺服器端設定）的 spec —— 見下方 projects 的說明。 */
const DB_MUTATING_SPECS = [
  "**/compare-flow.spec.ts",
  "**/watchlist-add.spec.ts",
  "**/settings-persistence.spec.ts",
];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",

  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  // 會寫入「共用狀態」的 spec 一律收進 db-mutating：
  //   - 播種 repo（compare-flow、watchlist-add）與依賴「空清單」斷言的 spec
  //     （dashboard onboarding）天生互斥
  //   - 改伺服器端全域設定（settings-persistence）三瀏覽器齊發會互相覆寫，
  //     各自把 stale 原值寫回去，終態可能永久停在錯的值
  // 它們排在三個瀏覽器 project 之後、串行單 worker 執行。
  // 代價：這些 spec 只在 chromium 跑，且前面任一 project 失敗時不會執行。
  // 判準：新增 spec 若會 POST/PUT/DELETE 共用資源，就要加進 DB_MUTATING_SPECS。
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: DB_MUTATING_SPECS,
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testIgnore: DB_MUTATING_SPECS,
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: DB_MUTATING_SPECS,
    },
    {
      name: "db-mutating",
      use: { ...devices["Desktop Chrome"] },
      testMatch: DB_MUTATING_SPECS,
      dependencies: ["chromium", "firefox", "webkit"],
      // 單 worker：fullyParallel 會把同 spec 的測試分散到多個 worker，
      // 每個 worker 各跑一次 beforeAll/afterAll → 併發播種 UNIQUE 互撞、
      // 先結束的 worker 清理時會刪掉另一個 worker 正在用的資料。
      fullyParallel: false,
      workers: 1,
    },
  ],

  /* Run local dev server before starting tests */
  webServer: process.env.CI
    ? undefined // Skip webServer in CI - servers are started manually or tests are skipped
    : [
        {
          // 隔離資料目錄——只在 playwright 自己啟動 sidecar 時生效；
          // 若開發者的 sidecar 已在跑（reuseExistingServer），重用的是真實資料庫，
          // 所以會寫入資料的測試仍必須自我清理（見 watchlist-flow.spec）。
          // DEBUG=false 關掉 uvicorn hot reload：測試中 lazy import 產生的 __pycache__
          // 會觸發 WatchFiles 重啟 server，in-flight 請求全部 ECONNRESET。
          // （load_dotenv 不覆蓋既有環境變數，此處設定優先於 sidecar/.env）
          command:
            "cd sidecar && STARSCOPE_DATA_DIR=/tmp/starscope-e2e DEBUG=false .venv/bin/python main.py",
          url: "http://127.0.0.1:8008/api/health",
          reuseExistingServer: true,
          timeout: 60000,
        },
        {
          command: "npm run dev",
          url: "http://localhost:1420",
          reuseExistingServer: true,
          timeout: 30000,
        },
      ],
});
