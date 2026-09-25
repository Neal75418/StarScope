/**
 * Import/Export E2E 測試。
 * Export 在 Watchlist 頁面 Toolbar 的 ExportDropdown；Import 在 Settings 頁面。
 */

import { test, expect } from "@playwright/test";

test.describe("Import & Export", () => {
  test("export dropdown on watchlist downloads JSON through fetch", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-watchlist"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });

    // 打開 export dropdown
    const exportBtn = page.locator('[data-testid="export-btn"]');
    await expect(exportBtn).toBeVisible({ timeout: 10000 });
    await exportBtn.click();

    // 不能是 <a href download>：那是頁面導覽，不帶 session secret，正式版的 sidecar 一律 403
    const menu = page.locator('[data-testid="export-menu"]');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await expect(menu.locator('[role="menuitem"]')).toHaveCount(2);
    await expect(menu.locator("a")).toHaveCount(0);

    // 瀏覽器裡（沒有 Tauri）退回 Blob 下載：確認真的下載了，而且內容是 sidecar 回的 JSON
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      menu.locator('[role="menuitem"]').first().click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^starscope_watchlist_\d{8}\.json$/);
    const path = await download.path();
    const { readFile } = await import("node:fs/promises");
    const body = JSON.parse(await readFile(path, "utf-8"));
    expect(body).toHaveProperty("repos");

    // 提示要看得到，不只是存在於 DOM：頁面外層若留著 transform，position: fixed 的 toast
    // 會以頁面而不是視窗為基準，被放到內容最底下、畫面之外。jsdom 看不到 CSS，只能在這裡驗
    await expect(page.locator(".toast-container")).toBeInViewport();
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
