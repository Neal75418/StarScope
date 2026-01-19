import { test, expect } from "@playwright/test";

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
  });

  test("should display the settings page title", async ({ page }) => {
    await expect(page.getByTestId("page-title")).toBeVisible();
  });

  test("should have GitHub connection section", async ({ page }) => {
    const githubSection = page.getByTestId("github-section");
    await expect(githubSection).toBeVisible({ timeout: 5000 });
  });

  test("should have export section", async ({ page }) => {
    const exportSection = page.getByTestId("export-section");
    await expect(exportSection).toBeVisible({ timeout: 5000 });
  });

  test("should have webhooks section", async ({ page }) => {
    const webhooksSection = page.getByTestId("webhooks-section");
    await expect(webhooksSection).toBeVisible({ timeout: 5000 });
  });

  test("should have export buttons in export section", async ({ page }) => {
    const exportSection = page.getByTestId("export-section");

    // Check for export links (JSON, CSV)
    const jsonLink = exportSection.locator('a:has-text("JSON")');
    const csvLink = exportSection.locator('a:has-text("CSV")');

    await expect(jsonLink.first()).toBeVisible({ timeout: 5000 });
    await expect(csvLink.first()).toBeVisible({ timeout: 5000 });
  });

  test("should navigate back to watchlist", async ({ page }) => {
    const watchlistNav = page.getByTestId("nav-watchlist");
    await watchlistNav.click();
    await expect(page).toHaveURL("/");
  });
});
