/**
 * Settings 持久化跨層流程測試。
 * 驗證設定變更在頁面重新載入後仍然保留。
 */

import { test, expect } from "@playwright/test";
import { SIDECAR } from "./helpers";

test.describe("Settings Persistence", () => {
  // 這支會改「伺服器端全域設定」（快照保留天數不是 per-context 的 localStorage）。
  // 三個 browser project 平行跑會互相覆寫、各自把 stale 的原值寫回去，
  // 終態可能永久停在錯的值——故由 playwright.config 的 db-mutating project 獨佔串行執行。
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // 導航至設定頁
    await page.locator('[data-testid="nav-settings"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toContainText(/設定|Settings/);
  });

  test("snapshot retention value persists after page reload", async ({ page, request }) => {
    // 找到快照保留天數的 section
    const section = page.locator("#snapshot-retention");
    await expect(section).toBeVisible({ timeout: 5000 });

    // 取得目前值
    const input = section.locator("input[type='number']");
    const currentValue = await input.inputValue();

    // 修改值
    const newValue = currentValue === "90" ? "60" : "90";
    try {
      await input.fill(newValue);
      const saveBtn = section.locator("button", { hasText: /儲存|Save/ });
      await saveBtn.click();

      // 儲存完成的訊號是按鈕「維持 disabled」：點擊後先因 isPending 而 disabled，
      // 成功後 inputDays 歸零、currentDays 同步 → 無變更可存 → 依設計繼續 disabled。
      // （舊斷言等 toBeEnabled，賭的是 invalidate 落地前的暫態窗口，約半數機率失敗）
      await expect(saveBtn).toBeDisabled({ timeout: 5000 });
      await expect
        .poll(
          async () => {
            const r = await request.get(`${SIDECAR}/api/settings/snapshot-retention`);
            return (await r.json())?.data?.retention_days;
          },
          { timeout: 5000 }
        )
        .toBe(parseInt(newValue, 10));

      // 重新載入頁面
      await page.reload();
      await page.locator('[data-testid="nav-settings"]').click();

      // 驗證值保留
      const retainedValue = await page
        .locator("#snapshot-retention input[type='number']")
        .inputValue();
      expect(retainedValue).toBe(newValue);
    } finally {
      // 還原走 API 而非 UI：填回原值後儲存鈕依設計是 disabled（isValid 要求
      // parsedDays !== currentDays），用 UI 點它會一路等 actionability 到測試逾時，
      // 把真正的斷言失敗蓋成一則 timeout。API 還原無條件成立、也不吃 UI 狀態。
      const restore = await request.put(`${SIDECAR}/api/settings/snapshot-retention`, {
        data: { retention_days: parseInt(currentValue, 10) },
      });
      expect(restore.ok(), "還原快照保留設定失敗").toBe(true);
      await expect
        .poll(
          async () => {
            const r = await request.get(`${SIDECAR}/api/settings/snapshot-retention`);
            return (await r.json())?.data?.retention_days;
          },
          { timeout: 5000 }
        )
        .toBe(parseInt(currentValue, 10));
    }
  });

  test("diagnostics section shows sidecar info", async ({ page }) => {
    const section = page.locator('[data-testid="diagnostics-section"]');
    await expect(section).toBeVisible({ timeout: 5000 });

    // 應該顯示版本號（格式 X.Y.Z）
    await expect(section.locator("text=/\\d+\\.\\d+\\.\\d+/")).toBeVisible({ timeout: 5000 });
  });
});
