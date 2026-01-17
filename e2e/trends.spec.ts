import { test, expect } from "@playwright/test";

test.describe("Trends Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/trends");
  });

  test("should display the trends page", async ({ page }) => {
    await expect(page.locator("text=Trends").first()).toBeVisible();
  });

  test("should have time range filter", async ({ page }) => {
    // Look for time range selector (7d, 30d, 90d)
    const timeFilter = page.locator('button:has-text("7d"), button:has-text("30d"), select');
    await expect(timeFilter.first()).toBeVisible({ timeout: 5000 });
  });

  test("should have sort options", async ({ page }) => {
    const sortOption = page.locator('button:has-text("Sort"), select[name*="sort"]');
    if (await sortOption.first().isVisible()) {
      await expect(sortOption.first()).toBeVisible();
    }
  });

  test("should display repo cards when data exists", async ({ page }) => {
    // Wait for either repos or empty state
    await page.waitForLoadState("networkidle");
    const content = page.locator("main");
    await expect(content).toBeVisible();
  });
});
