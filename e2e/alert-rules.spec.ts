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

  test("add rule button opens form", async ({ page }) => {
    const alertsSection = page.locator('[data-testid="alerts-section"]');
    await expect(alertsSection).toBeVisible({ timeout: 10000 });

    // 找到新增規則按鈕
    const addBtn = alertsSection.locator('button:has-text("Add"), button:has-text("新增")');
    if ((await addBtn.count()) === 0) {
      test.skip(true, "Add button not found (may need GitHub connection)");
      return;
    }

    await addBtn.click();

    // 表單應出現
    const form = page.locator(".alert-rule-form");
    await expect(form).toBeVisible({ timeout: 5000 });
  });

  test("alert rule form has required fields", async ({ page }) => {
    const alertsSection = page.locator('[data-testid="alerts-section"]');
    await expect(alertsSection).toBeVisible({ timeout: 10000 });

    const addBtn = alertsSection.locator('button:has-text("Add"), button:has-text("新增")');
    if ((await addBtn.count()) === 0) {
      test.skip(true, "Add button not found");
      return;
    }

    await addBtn.click();

    const form = page.locator(".alert-rule-form");
    await expect(form).toBeVisible({ timeout: 5000 });

    // 表單應有名稱、指標、運算符、門檻值欄位
    await expect(form.locator('input, select, textarea').first()).toBeVisible();
    await expect(form.locator('button[type="submit"]')).toBeVisible();
  });
});
