/**
 * 降級狀態 E2E 測試。
 * 驗證 sidecar 不可用時 UI 正確顯示降級橫幅。
 */

import { test, expect } from "@playwright/test";

test.describe("Degradation", () => {
  test("shows status banner when sidecar health check fails", async ({ page }) => {
    // 攔截 health check 並回傳錯誤
    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ success: false, data: null, error: "Service unavailable" }),
      })
    );

    await page.goto("/");

    // 應顯示降級橫幅
    const banner = page.locator('[data-testid="status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner).toContainText(/engine|引擎/i);
  });
});
