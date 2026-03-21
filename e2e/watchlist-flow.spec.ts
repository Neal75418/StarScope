import { test, expect } from "@playwright/test";

test.describe("Watchlist Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-watchlist"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
  });

  test("watchlist page has toolbar with add and refresh buttons", async ({ page }) => {
    await expect(page.locator('[data-testid="add-repo-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="refresh-all-btn"]')).toBeVisible();
  });

  test("add repo dialog opens and accepts input", async ({ page }) => {
    await page.locator('[data-testid="add-repo-btn"]').click();

    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const input = page.locator("#add-repo-input");
    await expect(input).toBeVisible();
    await input.fill("facebook/react");

    const submitBtn = dialog.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled();

    // Close dialog without submitting
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  test("can add a repo and see it in the list", async ({ page }) => {
    await page.locator('[data-testid="add-repo-btn"]').click();
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await page.locator("#add-repo-input").fill("vitejs/vite");
    await dialog.locator('button[type="submit"]').click();

    // Wait for dialog to close (success) — generous timeout for real API call
    await expect(dialog).not.toBeVisible({ timeout: 30000 });

    // Verify repo appears somewhere on the page
    await expect(page.locator("text=vitejs/vite").first()).toBeVisible({ timeout: 15000 });
  });

  test("refresh button works without crashing", async ({ page }) => {
    await page.locator('[data-testid="refresh-all-btn"]').click();
    // Page should remain functional
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
  });

  test("settings page has GitHub connection section", async ({ page }) => {
    await page.locator('[data-testid="nav-settings"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="github-section"]')).toBeVisible({ timeout: 10000 });
  });
});
