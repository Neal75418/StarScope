import { test, expect } from "@playwright/test";

test.describe("App Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
  });

  test("loads dashboard by default with page title visible", async ({ page }) => {
    const dashboardNav = page.locator('[data-testid="nav-dashboard"]');
    await expect(dashboardNav).toHaveClass(/active/);
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible();
  });

  test("can navigate to all 6 pages", async ({ page }) => {
    const pages = ["discovery", "watchlist", "trends", "compare", "settings", "dashboard"];

    for (const p of pages) {
      await page.locator(`[data-testid="nav-${p}"]`).click();
      await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
    }
  });

  test("theme toggle switches between light and dark", async ({ page }) => {
    const themeToggle = page.locator('[data-testid="theme-toggle"]');
    const initialTheme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );

    await themeToggle.click();
    const newTheme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    expect(newTheme).not.toBe(initialTheme);

    await themeToggle.click();
    const restored = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    expect(restored).toBe(initialTheme);
  });

  test("language toggle switches language", async ({ page }) => {
    const langToggle = page.locator('[data-testid="lang-toggle"]');
    const initial = await langToggle.textContent();

    await langToggle.click();
    const changed = await langToggle.textContent();
    expect(changed).not.toBe(initial);

    await langToggle.click();
    const restored = await langToggle.textContent();
    expect(restored).toBe(initial);
  });
});
