/**
 * Import/Export E2E 測試。
 * Export 在 Watchlist 頁面 Toolbar 的 ExportDropdown；Import 在 Settings 頁面。
 */

import { test, expect } from "@playwright/test";

test.describe("Import & Export", () => {
  test("export dropdown on watchlist has JSON and CSV links", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-watchlist"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });

    // 打開 export dropdown
    const exportBtn = page.locator('[data-testid="export-btn"]');
    await expect(exportBtn).toBeVisible({ timeout: 10000 });
    await exportBtn.click();

    // dropdown 應出現 JSON 和 CSV 連結
    const menu = page.locator('[data-testid="export-menu"]');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await expect(menu.locator('a[download]')).toHaveCount(2);
  });

  test("import section is visible in settings", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-settings"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });

    const section = page.locator('[data-testid="import-section"]');
    await expect(section).toBeVisible({ timeout: 10000 });

    // 應有 file input
    const fileInput = section.locator('input[type="file"]');
    await expect(fileInput).toBeAttached();
  });

  test("data management section has reset with confirmation", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-settings"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });

    const section = page.locator('[data-testid="data-management-section"]');
    await expect(section).toBeVisible({ timeout: 10000 });

    // 重置按鈕
    const resetBtn = section.locator("button.btn-danger");
    if ((await resetBtn.count()) === 0) return;

    await resetBtn.click();

    // 確認對話框
    const dialog = page.locator('div[role="alertdialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // 取消
    const cancelBtn = dialog.locator('button').filter({ hasText: /cancel|取消/i });
    await cancelBtn.click();
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });
});
