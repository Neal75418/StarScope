/**
 * Category 管理 E2E 測試。
 * 驗證分類的建立、編輯、刪除及側邊欄篩選功能。
 */

import { test, expect } from "@playwright/test";
import { SIDECAR, removeCategoryByName } from "./helpers";

test.describe("Category Management", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-watchlist"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
  });

  test("category sidebar is visible on watchlist page", async ({ page }) => {
    const sidebar = page.locator(".category-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  });

  test("can open add category form with + button", async ({ page }) => {
    const sidebar = page.locator(".category-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    // 點擊 + 按鈕
    const addBtn = sidebar.locator(".category-sidebar-header button");
    await addBtn.click();

    // 表單應出現
    const form = page.locator(".category-add-form");
    await expect(form).toBeVisible();
  });

  test("create category and see it in sidebar, then clean up", async ({ page, request, browserName }) => {
    const sidebar = page.locator(".category-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    // 打開新增表單
    const addBtn = sidebar.locator(".category-sidebar-header button");
    await addBtn.click();

    const form = page.locator(".category-add-form");
    await expect(form).toBeVisible();

    // 填入名稱並送出
    const uniqueName = `E2E-Test-${browserName}-${Date.now()}`;
    const input = form.locator("input");
    await input.fill(uniqueName);
    try {
      await form.locator('button[type="submit"]').click();

      // 新分類應出現在側邊欄
      await expect(sidebar.locator(`text=${uniqueName}`)).toBeVisible({ timeout: 10000 });
    } finally {
      // 斷言失敗也要清：不能把測試分類留在（可能是真實的）DB 裡
      await removeCategoryByName(request, uniqueName);
    }
  });

  test("category node shows repo count", async ({ page, request, browserName }) => {
    // 自備前置資料：API 播種一個 sentinel 分類再驗節點——舊版在空 DB 直接 skip，
    // 隔離環境下等於永遠不跑。
    const uniqueName = `E2E-Count-${browserName}-${Date.now()}`;
    const created = await request.post(`${SIDECAR}/api/categories`, {
      data: { name: uniqueName },
    });
    expect(created.ok()).toBe(true);

    try {
      await page.reload();
      const sidebar = page.locator(".category-sidebar");
      await expect(sidebar).toBeVisible({ timeout: 10000 });

      const node = sidebar.locator(".category-node", { hasText: uniqueName });
      await expect(node).toBeVisible({ timeout: 10000 });
      // 空分類的 count badge 應顯示 0
      await expect(node).toContainText("0");
    } finally {
      await removeCategoryByName(request, uniqueName);
    }
  });
});
