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
    // 還原放 finally：中途斷言失敗不能把使用者的主題留在切過的狀態
    const themeToggle = page.locator('[data-testid="theme-toggle"]');
    const initialTheme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );

    try {
      await themeToggle.click();
      const newTheme = await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme")
      );
      expect(newTheme).not.toBe(initialTheme);
    } finally {
      const current = await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme")
      );
      if (current !== initialTheme) await themeToggle.click();
    }

    const restored = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    expect(restored).toBe(initialTheme);
  });

  test("language toggle switches language", async ({ page }) => {
    const langToggle = page.locator('[data-testid="lang-toggle"]');
    const initial = await langToggle.textContent();

    try {
      await langToggle.click();
      const changed = await langToggle.textContent();
      expect(changed).not.toBe(initial);
    } finally {
      if ((await langToggle.textContent()) !== initial) await langToggle.click();
    }

    const restored = await langToggle.textContent();
    expect(restored).toBe(initial);
  });

  test("page remembers last visited page after reload", async ({ page }) => {
    // 導航至 Trends
    await page.locator('[data-testid="nav-trends"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });

    // 重新載入
    await page.reload();
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });

    // 應仍在 Trends（localStorage 持久化）
    await expect(page.locator('[data-testid="nav-trends"]')).toHaveClass(/active/);
  });

});
