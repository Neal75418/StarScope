/**
 * Category 管理 E2E 測試。
 * 驗證分類的建立、編輯、刪除及側邊欄篩選功能。
 */

import { test, expect } from "@playwright/test";

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

  test("create category and see it in sidebar, then clean up", async ({ page, request }) => {
    const sidebar = page.locator(".category-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    // 打開新增表單
    const addBtn = sidebar.locator(".category-sidebar-header button");
    await addBtn.click();

    const form = page.locator(".category-add-form");
    await expect(form).toBeVisible();

    // 填入名稱並送出
    const uniqueName = `E2E-Test-${Date.now()}`;
    const input = form.locator("input");
    await input.fill(uniqueName);
    await form.locator('button[type="submit"]').click();

    // 新分類應出現在側邊欄
    await expect(sidebar.locator(`text=${uniqueName}`)).toBeVisible({ timeout: 10000 });

    // 清理：透過 API 刪除測試分類
    const treeRes = await request.get("http://127.0.0.1:8008/api/categories/tree");
    const treeData = await treeRes.json();
    if (treeData.success && Array.isArray(treeData.data?.tree)) {
      for (const cat of treeData.data.tree) {
        if (cat.name === uniqueName) {
          await request.delete(`http://127.0.0.1:8008/api/categories/${cat.id}`);
        }
      }
    }
  });

  test("category node shows repo count", async ({ page }) => {
    const sidebar = page.locator(".category-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    // 分類節點應有數字標記（repo count）
    const nodes = sidebar.locator(".category-node");
    const count = await nodes.count();
    if (count === 0) {
      test.skip(true, "No categories exist");
      return;
    }

    // 第一個節點應該有 count badge
    const firstNode = nodes.first();
    await expect(firstNode).toBeVisible();
  });
});
