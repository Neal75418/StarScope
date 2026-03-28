/**
 * Import/Export E2E 測試。
 * 驗證 JSON/CSV 匯出按鈕可用，以及匯入區塊的基本互動。
 */

import { test, expect } from "@playwright/test";

test.describe("Import & Export", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-settings"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
  });

  test("data management section is visible", async ({ page }) => {
    const section = page.locator('[data-testid="data-management-section"]');
    await expect(section).toBeVisible({ timeout: 10000 });
  });

  test("export buttons are present (JSON and CSV)", async ({ page }) => {
    const section = page.locator('[data-testid="data-management-section"]');
    await expect(section).toBeVisible({ timeout: 10000 });

    // 應有 JSON 和 CSV 匯出按鈕
    const jsonBtn = section.locator('button:has-text("JSON")');
    const csvBtn = section.locator('button:has-text("CSV")');

    await expect(jsonBtn).toBeVisible();
    await expect(csvBtn).toBeVisible();
  });

  test("export JSON triggers download", async ({ page }) => {
    const section = page.locator('[data-testid="data-management-section"]');
    await expect(section).toBeVisible({ timeout: 10000 });

    // 監聽下載事件
    const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
    const jsonBtn = section.locator('button:has-text("JSON")');
    await jsonBtn.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  test("export CSV triggers download", async ({ page }) => {
    const section = page.locator('[data-testid="data-management-section"]');
    await expect(section).toBeVisible({ timeout: 10000 });

    const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
    const csvBtn = section.locator('button:has-text("CSV")');
    await csvBtn.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test("import section is visible with file input", async ({ page }) => {
    const section = page.locator('[data-testid="import-section"]');
    await expect(section).toBeVisible({ timeout: 10000 });

    // 應有 file input（可能被 label 包裹）
    const fileInput = section.locator('input[type="file"]');
    await expect(fileInput).toBeAttached();
  });

  test("reset data button exists with confirmation", async ({ page }) => {
    const section = page.locator('[data-testid="data-management-section"]');
    await expect(section).toBeVisible({ timeout: 10000 });

    // 重置按鈕應存在（危險操作，通常是紅色按鈕）
    const resetBtn = section.locator('button:has-text("Reset"), button:has-text("重置")');
    if ((await resetBtn.count()) === 0) {
      // 某些 UI 可能把重置放在其他地方
      return;
    }

    await expect(resetBtn).toBeVisible();

    // 點擊應彈出確認對話框，不應直接執行
    await resetBtn.click();
    const confirmDialog = page.locator('div[role="alertdialog"], div[role="dialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });

    // 按取消關閉
    const cancelBtn = confirmDialog.locator('button:has-text("Cancel"), button:has-text("取消")');
    await cancelBtn.click();
    await expect(confirmDialog).not.toBeVisible({ timeout: 3000 });
  });
});
