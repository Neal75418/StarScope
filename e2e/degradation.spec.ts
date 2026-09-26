/**
 * 降級狀態 E2E 測試。
 * 驗證 sidecar 不可用時 UI 正確顯示降級橫幅：還在啟動時間內說「啟動中」，
 * 過了啟動時間仍連不上才說「沒有回應」（見 src/api/sidecarConnection.ts）。
 */

import { test, expect } from "@playwright/test";

// 與 src/api/sidecarConnection.ts 的 STARTUP_GRACE_MS 一致
const STARTUP_GRACE_MS = 45_000;

test.describe("Degradation", () => {
  test.beforeEach(async ({ page }) => {
    // 攔截 health check 並回傳錯誤
    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ success: false, data: null, error: "Service unavailable" }),
      })
    );
  });

  test("says the engine is starting while it has not answered yet", async ({ page }) => {
    await page.goto("/");

    const banner = page.locator('[data-testid="status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner).toContainText(/Starting the data engine|資料引擎啟動中/);
  });

  test("says the engine is not responding once the startup window passes", async ({ page }) => {
    await page.clock.install();
    await page.goto("/");

    const banner = page.locator('[data-testid="status-banner"]');
    await expect(banner).toContainText(/Starting the data engine|資料引擎啟動中/, {
      timeout: 10000,
    });

    await page.clock.fastForward(STARTUP_GRACE_MS + 1_000);

    await expect(banner).toContainText(/not responding|沒有回應/);
    // 從沒連上過：不掛頁面（頁面會以為沒有資料、畫出「還沒追蹤任何專案」），改說引擎沒在跑
    await expect(page.getByTestId("sidecar-unavailable")).toBeVisible();
    await expect(page.getByTestId("dashboard-onboard")).toHaveCount(0);
  });
});
