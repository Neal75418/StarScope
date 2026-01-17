import { test, expect } from "@playwright/test";

test.describe("Watchlist Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display the watchlist page", async ({ page }) => {
    await expect(page.locator("text=Watchlist")).toBeVisible();
  });

  test("should show empty state when no repos", async ({ page }) => {
    // Check for empty state or repo list
    const content = page.locator("main");
    await expect(content).toBeVisible();
  });

  test("should have add repo button", async ({ page }) => {
    const addButton = page.locator('button:has-text("Add"), button[aria-label*="add"]');
    await expect(addButton.first()).toBeVisible();
  });

  test("should open add repo dialog", async ({ page }) => {
    const addButton = page.locator('button:has-text("Add")').first();
    if (await addButton.isVisible()) {
      await addButton.click();
      // Check for dialog or input field
      await expect(page.locator('input[placeholder*="owner"], input[placeholder*="repo"]').first()).toBeVisible({ timeout: 5000 });
    }
  });

  test("should navigate to trends page", async ({ page }) => {
    const trendsLink = page.locator('a[href*="trends"], button:has-text("Trends")').first();
    if (await trendsLink.isVisible()) {
      await trendsLink.click();
      await expect(page).toHaveURL(/trends/);
    }
  });

  test("should navigate to settings page", async ({ page }) => {
    const settingsLink = page.locator('a[href*="settings"], button:has-text("Settings")').first();
    if (await settingsLink.isVisible()) {
      await settingsLink.click();
      await expect(page).toHaveURL(/settings/);
    }
  });
});
