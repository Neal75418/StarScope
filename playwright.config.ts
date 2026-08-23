import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration for StarScope
 * @see https://playwright.dev/docs/test-configuration
 */
/**
 * e2e 專屬 port：刻意不同於開發用的 8008/1420，測試才不會接管開發者正在跑的
 * server 與真實資料庫。CI 手動起 server 時必須用同一組（見 .github/workflows/test.yml）。
 */
const E2E_SIDECAR_PORT = 8009;
const E2E_WEB_PORT = 1421;

/** 會寫入共用狀態（DB / 伺服器端設定）的 spec —— 見下方 projects 的說明。 */
const DB_MUTATING_SPECS = [
  "**/compare-flow.spec.ts",
  "**/watchlist-add.spec.ts",
  "**/settings-persistence.spec.ts",
];

// noinspection JSUnusedGlobalSymbols — Playwright 依檔名慣例載入本檔，不經由 import。
// 證據：CI 跑 `playwright test --project=db-mutating`，而該 project 名稱定義在下方，
// 設定檔若沒被載入這道指令會直接失敗。
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",

  use: {
    baseURL: `http://localhost:${E2E_WEB_PORT}`,
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
      // CI 只安裝 chromium，列上 firefox/webkit 會讓它嘗試啟動未安裝的瀏覽器
      dependencies: process.env.CI ? ["chromium"] : ["chromium", "firefox", "webkit"],
      // 單 worker：fullyParallel 會把同 spec 的測試分散到多個 worker，
      // 每個 worker 各跑一次 beforeAll/afterAll → 併發播種 UNIQUE 互撞、
      // 先結束的 worker 清理時會刪掉另一個 worker 正在用的資料。
      fullyParallel: false,
      workers: 1,
    },
  ],

  /* Run local dev server before starting tests */
  // e2e 一律跑自己的 sidecar（port 8009 + /tmp 資料目錄）與自己的 vite（1421），
  // 而且不重用既有 server。理由：reuseExistingServer 會接管開發者正在跑的 sidecar，
  // 那是真實資料庫——測試進到探索頁就會用使用者的真實興趣清單觸發當日 feed 產生，
  // 把當天的 feed 提前用掉（seen_repos 是永久的），配額吃緊時甚至會把縮水的 feed
  // 鎖成當天結果。改成專屬 port 後，開著 app 也能安全跑 e2e。
  // 殘留風險：GitHub 配額仍是同一顆 token 共用，隔離 DB 擋不住。
  webServer: process.env.CI
    ? undefined // Skip webServer in CI - servers are started manually or tests are skipped
    : [
        {
          command:
            `cd sidecar && PORT=${E2E_SIDECAR_PORT} STARSCOPE_DATA_DIR=/tmp/starscope-e2e DEBUG=false ${process.env.E2E_NO_TOKEN ? "PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= " : ""} .venv/bin/python main.py`,
          url: `http://127.0.0.1:${E2E_SIDECAR_PORT}/api/health`,
          reuseExistingServer: false,
          timeout: 60000,
        },
        {
          command: `VITE_API_URL=http://127.0.0.1:${E2E_SIDECAR_PORT} npm run dev -- --port ${E2E_WEB_PORT} --strictPort`,
          url: `http://localhost:${E2E_WEB_PORT}`,
          reuseExistingServer: false,
          timeout: 30000,
        },
      ],
});
