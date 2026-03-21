import { test, expect } from "@playwright/test";

test.describe("Discovery Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-discovery"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
  });

  test("discovery page loads with search bar", async ({ page }) => {
    await expect(page.locator('[data-testid="discovery-search-input"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="discovery-search-submit"]')).toBeVisible();
  });

  test("trending period buttons are visible", async ({ page }) => {
    await expect(page.locator('[data-testid="trending-daily"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="trending-weekly"]')).toBeVisible();
    await expect(page.locator('[data-testid="trending-monthly"]')).toBeVisible();
  });

  test("can search and see results", async ({ page }) => {
    const searchInput = page.locator('[data-testid="discovery-search-input"]');
    await searchInput.fill("react");
    await page.locator('[data-testid="discovery-search-submit"]').click();

    await expect(page.locator('[data-testid^="discovery-result-"]').first()).toBeVisible({ timeout: 15000 });
  });

  test("filter controls are visible", async ({ page }) => {
    await expect(page.locator('[data-testid="discovery-filters"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="filter-language"]')).toBeVisible();
  });

  test("clicking trending period loads results", async ({ page }) => {
    const dailyBtn = page.locator('[data-testid="trending-daily"]');
    await expect(dailyBtn).toBeVisible({ timeout: 10000 });

    await dailyBtn.click();

    await expect(
      page.locator('[data-testid="discovery-results"]').or(page.locator('[data-testid^="discovery-result-"]').first())
    ).toBeVisible({ timeout: 15000 });
  });

  test("search input can be cleared and re-searched", async ({ page }) => {
    const searchInput = page.locator('[data-testid="discovery-search-input"]');
    await searchInput.fill("vue");
    await page.locator('[data-testid="discovery-search-submit"]').click();

    await expect(page.locator('[data-testid^="discovery-result-"]').first()).toBeVisible({ timeout: 15000 });

    await searchInput.clear();
    await searchInput.fill("svelte");
    await page.locator('[data-testid="discovery-search-submit"]').click();

    await expect(page.locator('[data-testid^="discovery-result-"]').first()).toBeVisible({ timeout: 15000 });
  });

  test("quick picks section is visible before search", async ({ page }) => {
    await expect(page.locator('[data-testid="quick-picks"]')).toBeVisible({ timeout: 10000 });
  });
});
