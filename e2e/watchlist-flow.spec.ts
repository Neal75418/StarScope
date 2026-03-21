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

  test("can add a repo and see it in the list", async ({ page }) => {
    await page.locator('[data-testid="add-repo-btn"]').click();
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await page.locator("#add-repo-input").fill("vitejs/vite");
    await dialog.locator('button[type="submit"]').click();

    // 等待 dialog 關閉（成功）
    await expect(dialog).not.toBeVisible({ timeout: 30000 });

    // 驗證 repo 出現
    await expect(page.locator("text=vitejs/vite").first()).toBeVisible({ timeout: 15000 });
  });

  test("refresh button works without crashing", async ({ page }) => {
    await page.locator('[data-testid="refresh-all-btn"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
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
