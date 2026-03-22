/**
 * GitHub Connection E2E 測試。
 * 驗證連線狀態在 Settings 中正確顯示。
 */

import { test, expect } from "@playwright/test";

test.describe("GitHub Connection", () => {
  test("shows connection status in settings", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-testid="nav-settings"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });

    const githubSection = page.locator("#github");
    await expect(githubSection).toBeVisible({ timeout: 5000 });

    // 應顯示 GitHub 連線區塊（已連接或 Device Flow 按鈕）
    await expect(
      githubSection.locator("button").first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("diagnostics section shows scheduler health", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-testid="nav-settings"]').click();

    const diagnostics = page.locator('[data-testid="diagnostics-section"]');
    await expect(diagnostics).toBeVisible({ timeout: 5000 });

    // 應顯示版本號
    await expect(diagnostics.locator("text=/\\d+\\.\\d+\\.\\d+/")).toBeVisible({ timeout: 5000 });
    // 應顯示資料庫大小
    await expect(diagnostics.locator("text=/MB/")).toBeVisible({ timeout: 5000 });
  });
});
