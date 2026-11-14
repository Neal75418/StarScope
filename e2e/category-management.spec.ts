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

  test("editing a category opens a dialog that covers the page", async ({
    page,
    request,
    browserName,
  }) => {
    const uniqueName = `E2E-Edit-${browserName}-${Date.now()}`;
    const created = await request.post(`${SIDECAR}/api/categories`, {
      data: { name: uniqueName },
    });
    expect(created.ok()).toBe(true);

    try {
      await page.reload();
      const node = page.locator(".category-sidebar .category-node", { hasText: uniqueName });
      await expect(node).toBeVisible({ timeout: 10000 });
      const editBtn = node.locator(".category-edit-btn");
      // 用鍵盤開：最後要驗關閉後焦點回到編輯鈕，而 macOS 的 WebKit 用滑鼠點按鈕不會讓它取得焦點
      await editBtn.focus();
      await page.keyboard.press("Enter");

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("#category-edit-name")).toBeFocused();

      // 遮罩蓋住側欄：分類列中心點最上層的元素要是遮罩，編輯到一半才不會按到刪除或切到別的分類。
      // 量測點在畫面外、或落在別的東西上都不算通過
      const hit = await node.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const topmost = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        const overlay = document.querySelector('[role="dialog"]')?.parentElement;
        if (topmost === null) return "offscreen";
        if (el.contains(topmost)) return "sidebar";
        return overlay?.contains(topmost) ? "overlay" : "other";
      });
      expect(hit).toBe("overlay");

      // 遮罩剛好是整個視窗，對話框比它窄、在它裡面水平置中。
      // 只量「對話框在視窗內、置中」不夠：樣式沒套上時它是 body 底下一塊滿版的區塊，中心同樣在視窗中線
      const overlayBox = await dialog.locator("xpath=..").boundingBox();
      const box = await dialog.boundingBox();
      const client = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      }));
      expect(overlayBox).toEqual({ x: 0, y: 0, width: client.width, height: client.height });
      expect(box).not.toBeNull();
      if (box && overlayBox) {
        expect(box.width).toBeLessThan(overlayBox.width);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(overlayBox.height);
        expect(Math.abs(box.x + box.width / 2 - overlayBox.width / 2)).toBeLessThan(2);
      }
      // 對話框本體有自己的底色：沒有的話是透明的，後面的頁面會透出來
      const dialogBackground = await dialog.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(dialogBackground).not.toBe("rgba(0, 0, 0, 0)");

      // 在名稱欄按下、拖到框外的遮罩上才放開（拖曳選取文字時常這樣）：不能當成點了遮罩而關閉
      const nameBox = await dialog.locator("#category-edit-name").boundingBox();
      expect(nameBox).not.toBeNull();
      if (nameBox) {
        await page.mouse.move(nameBox.x + nameBox.width / 2, nameBox.y + nameBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(10, 10, { steps: 5 });
        await page.mouse.up();
      }
      await expect(dialog).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(editBtn).toBeFocused();
    } finally {
      await removeCategoryByName(request, uniqueName);
    }
  });
});
