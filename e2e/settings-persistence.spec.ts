/**
 * Settings 持久化跨層流程測試。
 * 驗證設定變更在頁面重新載入後仍然保留。
 */

import { test, expect } from "@playwright/test";

test.describe("Settings Persistence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // 導航至設定頁
    await page.locator('[data-testid="nav-settings"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toContainText(/設定|Settings/);
  });

  test("snapshot retention value persists after page reload", async ({ page }) => {
    // 找到快照保留天數的 section
    const section = page.locator("#snapshot-retention");
    await expect(section).toBeVisible({ timeout: 5000 });

    // 取得目前值
    const input = section.locator("input[type='number']");
    const currentValue = await input.inputValue();

    // 修改值
    const newValue = currentValue === "90" ? "60" : "90";
    await input.fill(newValue);
    await section.locator("button", { hasText: /儲存|Save/ }).click();

    // 等待儲存完成（按鈕恢復可點擊狀態）
    await expect(section.locator("button", { hasText: /儲存|Save/ })).toBeEnabled({ timeout: 5000 });

    // 重新載入頁面
    await page.reload();
    await page.locator('[data-testid="nav-settings"]').click();

    // 驗證值保留
    const retainedValue = await page.locator("#snapshot-retention input[type='number']").inputValue();
    expect(retainedValue).toBe(newValue);

    // 還原
    await page.locator("#snapshot-retention input[type='number']").fill(currentValue);
    await page.locator("#snapshot-retention button", { hasText: /儲存|Save/ }).click();
  });

  test("diagnostics section shows sidecar info", async ({ page }) => {
    const section = page.locator("#diagnostics");
    await expect(section).toBeVisible({ timeout: 5000 });

    // 應該顯示版本號（格式 X.Y.Z）
    await expect(section.locator("text=/\\d+\\.\\d+\\.\\d+/")).toBeVisible({ timeout: 5000 });
  });
});
