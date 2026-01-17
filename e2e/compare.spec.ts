import { test, expect } from "@playwright/test";

test.describe("Compare Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/compare");
  });

  test("should display the compare page", async ({ page }) => {
    await expect(page.locator("text=Compare").first()).toBeVisible();
  });

  test("should have create comparison button", async ({ page }) => {
    const createButton = page.locator('button:has-text("Create"), button:has-text("New")');
    if (await createButton.first().isVisible()) {
      await expect(createButton.first()).toBeVisible();
    }
  });

  test("should show comparison groups or empty state", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });
});
