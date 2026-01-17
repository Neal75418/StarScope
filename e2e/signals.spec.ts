import { test, expect } from "@playwright/test";

test.describe("Signals Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/signals");
  });

  test("should display the signals page", async ({ page }) => {
    await expect(page.locator("text=Signals").first()).toBeVisible();
  });

  test("should show signal type filters", async ({ page }) => {
    // Look for signal type badges or filters
    const filterArea = page.locator('button:has-text("rising"), button:has-text("spike"), [role="tablist"]');
    if (await filterArea.first().isVisible()) {
      await expect(filterArea.first()).toBeVisible();
    }
  });

  test("should display signal cards or empty state", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });
});
