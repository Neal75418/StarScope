/**
 * Compare 頁面 E2E 測試。
 * 驗證 repo 選擇、指標切換與圖表渲染。
 */

import { test, expect } from "@playwright/test";

test.describe("Compare Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-compare"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
  });

  test("compare page shows repo selector", async ({ page }) => {
    // RepoSelector 區塊應該可見
    const selector = page.locator(".compare-repo-selector");
    await expect(selector).toBeVisible({ timeout: 10000 });
  });

  test("shows empty state when no repos selected", async ({ page }) => {
    // 沒選 repo 時不應顯示圖表控制項
    await expect(page.locator('[data-testid="compare-metric-toggle"]')).not.toBeVisible();
  });

  test("selecting repos shows chart and metrics", async ({ page }) => {
    // 等待 repo chip 按鈕出現（需要 watchlist 有 repo）
    const chips = page.locator(".compare-repo-chip");
    const chipCount = await chips.count();

    // 如果 watchlist 沒有 repo，跳過
    if (chipCount < 2) {
      test.skip(true, "Need at least 2 repos in watchlist for compare test");
      return;
    }

    // 選擇前兩個 repo
    await chips.nth(0).click();
    await chips.nth(1).click();

    // 圖表區應該出現
    const chart = page.locator(".compare-chart-area");
    await expect(chart).toBeVisible({ timeout: 15000 });

    // DiffSummaryPanel 應該出現
    await expect(page.locator('[data-testid="diff-summary-panel"]')).toBeVisible({ timeout: 10000 });
  });

  test("metric toggle changes aria-pressed state", async ({ page }) => {
    const chips = page.locator(".compare-repo-chip");
    if ((await chips.count()) < 2) {
      test.skip(true, "Need at least 2 repos");
      return;
    }

    await chips.nth(0).click();
    await chips.nth(1).click();

    // 等待 metric toggle 出現
    const metricToggle = page.locator('[data-testid="compare-metric-toggle"]');
    await expect(metricToggle).toBeVisible({ timeout: 15000 });

    // 預設 Stars 被選中
    const starsBtn = metricToggle.locator('button:has-text("Stars")');
    await expect(starsBtn).toHaveAttribute("aria-pressed", "true");

    // 切換到 Forks
    const forksBtn = metricToggle.locator('button:has-text("Forks")');
    await forksBtn.click();
    await expect(forksBtn).toHaveAttribute("aria-pressed", "true");
    await expect(starsBtn).toHaveAttribute("aria-pressed", "false");
  });
});
