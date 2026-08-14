/**
 * Dashboard 頁面 E2E 測試。
 *
 * e2e 環境的資料庫是空的（無追蹤 repo），此時儀表板的設計行為是收斂成
 * 單一引導卡、不渲染任何 widget——所以這裡驗證的是引導卡與其導向；
 * widget 在有資料時的渲染由 Dashboard 單元測試（mock 資料）覆蓋。
 */

import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
  });

  test("collapses to an onboarding card when nothing is tracked", async ({ page }) => {
    await expect(page.locator('[data-testid="dashboard-onboard"]')).toBeVisible({
      timeout: 10000,
    });
    // 空狀態不渲染統計卡與任何 widget——六個模組各自喊「沒資料」正是這張卡要取代的東西
    expect(await page.locator(".stat-card").count()).toBe(0);
    expect(await page.locator(".weekly-summary").count()).toBe(0);
  });

  test("onboarding CTA navigates to Discover", async ({ page }) => {
    await page.locator('[data-testid="dashboard-onboard-cta"]').click();

    // 探索頁預設畫面：feed 或其空狀態（沿用 for-you-feed.spec 的判準）
    const feed = page.locator('[data-testid="for-you-feed"]');
    const empty = page.locator('[data-testid="feed-empty-state"]');
    await expect(feed.or(empty).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="nav-discovery"]')).toHaveClass(/active/);
  });

  test("theme persists after page reload", async ({ page }) => {
    const initialTheme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    await page.locator('[data-testid="theme-toggle"]').click();

    try {
      const themeAfterToggle = await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme")
      );

      await page.reload();
      await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });

      const themeAfterReload = await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme")
      );
      expect(themeAfterReload).toBe(themeAfterToggle);
    } finally {
      // 還原放 finally：斷言失敗也不能把使用者主題留在切過的狀態
      const current = await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme")
      );
      if (current !== initialTheme) {
        await page.locator('[data-testid="theme-toggle"]').click();
      }
    }
  });
});
