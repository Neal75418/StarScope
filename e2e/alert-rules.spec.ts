/**
 * Alert Rules E2E 測試。
 * 驗證警報規則的建立、toggle 和刪除功能。
 */

import { test, expect } from "@playwright/test";

test.describe("Alert Rules", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-settings"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
  });

  test("alerts section is visible with signal type info", async ({ page }) => {
    const alertsSection = page.locator('[data-testid="alerts-section"]');
    await expect(alertsSection).toBeVisible({ timeout: 10000 });
  });

  test("alert rule list shows rules or empty state", async ({ page }) => {
    const alertsSection = page.locator('[data-testid="alerts-section"]');
    await expect(alertsSection).toBeVisible({ timeout: 10000 });

    // 應該有規則列表或空狀態
    const hasRules = await alertsSection.locator(".alert-rule-card").count();
    const hasEmpty = await alertsSection.locator(".alert-rule-empty").count();
    expect(hasRules + hasEmpty).toBeGreaterThan(0);
  });

  // 建立按鈕的實際文案是 "Create Alert"／「建立警報」。舊版 selector 找
  // "Add"／「新增」永遠 0 命中，兩條測試從誕生起就一直靜默 skip——
  // 條件 skip 改為硬斷言：按鈕找不到就該紅，不是跳過。
  const CREATE_BTN = 'button:has-text("Create Alert"), button:has-text("建立警報")';

  test("create alert button opens form", async ({ page }) => {
    const alertsSection = page.locator('[data-testid="alerts-section"]');
    await expect(alertsSection).toBeVisible({ timeout: 10000 });

    await alertsSection.locator(CREATE_BTN).click();

    const form = page.locator(".alert-rule-form");
    await expect(form).toBeVisible({ timeout: 5000 });
  });

  test("alert rule form has required fields", async ({ page }) => {
    const alertsSection = page.locator('[data-testid="alerts-section"]');
    await expect(alertsSection).toBeVisible({ timeout: 10000 });

    await alertsSection.locator(CREATE_BTN).click();

    const form = page.locator(".alert-rule-form");
    await expect(form).toBeVisible({ timeout: 5000 });

    // 名稱 input、訊號類型/運算子 select、門檻 input、送出按鈕——逐一驗證
    await expect(form.locator("input").first()).toBeVisible();
    expect(await form.locator("select").count()).toBeGreaterThanOrEqual(2);
    expect(await form.locator("input").count()).toBeGreaterThanOrEqual(2);
    await expect(form.locator('button[type="submit"]')).toBeVisible();
  });
});
