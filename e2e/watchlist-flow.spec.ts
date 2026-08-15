import { test, expect } from "@playwright/test";

// 會播種 repo 的「新增」流程已移到 watchlist-add.spec.ts（由 db-mutating project
// 串行獨佔）——本檔只剩唯讀的 UI 檢查，可安全地跨瀏覽器平行執行。

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
    // 等待 add-repo-btn 可見（需 sidecar 連線成功後才會渲染）
    await expect(page.locator('[data-testid="add-repo-btn"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="add-repo-btn"]').click();

    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const input = page.locator("#add-repo-input");
    await expect(input).toBeVisible();
    await input.fill("facebook/react");

    const submitBtn = dialog.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled();
  });

  test("refresh button is disabled when the watchlist is empty", async ({ page }) => {
    // 空清單沒有東西可刷新，設計上按鈕就是 disabled（Toolbar.tsx: totalCount === 0）。
    // 過去這條測試點擊成功，靠的是先前測試殘留的污染資料——那不是可依賴的前提。
    const btn = page.locator('[data-testid="refresh-all-btn"]');
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test("view mode toggle exists", async ({ page }) => {
    await expect(page.locator('[data-testid="view-mode-toggle"]')).toBeVisible();
  });

  test("sort tabs are visible", async ({ page }) => {
    await expect(page.locator('[data-testid="sort-tabs"]')).toBeVisible();
  });

  test("settings page has GitHub connection and alerts sections", async ({ page }) => {
    await page.locator('[data-testid="nav-settings"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="github-section"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="alerts-section"]')).toBeVisible();
  });
});
