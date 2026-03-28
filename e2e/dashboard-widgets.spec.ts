/**
 * Dashboard 頁面 E2E 測試。
 * 驗證首頁的統計卡片、週報摘要和投資組合圖表正確渲染。
 */

import { test, expect } from "@playwright/test";

test.describe("Dashboard Widgets", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
  });

  test("displays stat cards with numeric values", async ({ page }) => {
    // Dashboard 是預設頁面，統計卡片應該可見
    const statCards = page.locator(".stat-card");
    await expect(statCards.first()).toBeVisible({ timeout: 10000 });

    // 至少有 4 張統計卡片（repos, stars, weekly, alerts）
    const count = await statCards.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test("weekly summary section renders with date range", async ({ page }) => {
    // 週報摘要區塊應該可見
    const summary = page.locator(".weekly-summary");
    await expect(summary).toBeVisible({ timeout: 10000 });

    // 應顯示日期範圍格式 M/D – M/D
    await expect(summary.locator("text=/\\d+\\/\\d+\\s*–\\s*\\d+\\/\\d+/")).toBeVisible();
  });

  test("portfolio history chart renders SVG", async ({ page }) => {
    // 投資組合圖表區塊
    const chart = page.locator(".portfolio-history-section");
    await expect(chart).toBeVisible({ timeout: 10000 });

    // recharts 渲染 SVG
    await expect(chart.locator("svg")).toBeVisible();
  });

  test("recent activity list shows items or empty state", async ({ page }) => {
    // 近期活動區塊 — 透過標題定位 dashboard section
    const hasItems = await page.locator(".activity-item").count();
    const hasEmpty = await page.locator(".activity-empty").count();
    expect(hasItems + hasEmpty).toBeGreaterThan(0);
  });

  test("theme persists after page reload", async ({ page }) => {
    const themeToggle = page.locator('[data-testid="theme-toggle"]');
    await themeToggle.click();

    const themeAfterToggle = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );

    await page.reload();
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });

    const themeAfterReload = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    expect(themeAfterReload).toBe(themeAfterToggle);

    // 還原：再切回去
    await page.locator('[data-testid="theme-toggle"]').click();
  });
});
