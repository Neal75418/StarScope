import { test, expect } from "@playwright/test";

test.describe("Discovery Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-discovery"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
  });

  test("discovery page loads with search bar", async ({ page }) => {
    const searchInput = page.locator("form input[type='text']").first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });
  });

  test("trending period buttons are visible", async ({ page }) => {
    const trendingButtons = page.locator('button[class*="trendingTag"]');
    await expect(trendingButtons.first()).toBeVisible({ timeout: 10000 });
    const count = await trendingButtons.count();
    expect(count).toBe(3);
  });

  test("can search and see results", async ({ page }) => {
    const searchInput = page.locator("form input[type='text']").first();
    await searchInput.fill("react");
    await searchInput.press("Enter");

    // Wait for result cards to appear
    const resultCards = page.locator('[class*="resultCard"]');
    await expect(resultCards.first()).toBeVisible({ timeout: 15000 });
  });

  test("filter controls are visible", async ({ page }) => {
    // Filters appear after trending auto-loads
    const filterSelects = page.locator('[class*="filterSelect"]');
    await expect(filterSelects.first()).toBeVisible({ timeout: 10000 });

    const count = await filterSelects.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test("clicking trending period loads results", async ({ page }) => {
    const trendingButtons = page.locator('button[class*="trendingTag"]');
    await expect(trendingButtons.first()).toBeVisible({ timeout: 10000 });

    await trendingButtons.first().click();
    await expect(trendingButtons.first()).toHaveClass(/active/);

    // Results or empty state should appear
    await expect(
      page.locator('[class*="results"]').or(page.locator('[class*="emptyState"]'))
    ).toBeVisible({ timeout: 15000 });
  });
});
