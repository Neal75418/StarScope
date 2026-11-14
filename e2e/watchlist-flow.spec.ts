import { test, expect } from "@playwright/test";

// 會播種 repo 的「新增」流程已移到 watchlist-add.spec.ts（由 db-mutating project
// 串行獨佔）——本檔只剩唯讀的 UI 檢查，可安全地跨瀏覽器平行執行。

test.describe("Watchlist Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-watchlist"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
  });

  test("watchlist page has toolbar with add and refresh buttons", async ({ page }) => {
    await expect(page.locator('[data-testid="add-repo-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="refresh-all-btn"]')).toBeVisible();
  });

  test("add repo dialog opens and accepts input", async ({ page }) => {
    // 等待 add-repo-btn 可見（需 sidecar 連線成功後才會渲染）
    await expect(page.locator('[data-testid="add-repo-btn"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="add-repo-btn"]').click();

    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const input = page.locator("#add-repo-input");
    await expect(input).toBeVisible();
    await input.fill("facebook/react");

    const submitBtn = dialog.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled();
  });

  test("Escape closes the add repo dialog while typing in it", async ({ page }) => {
    await page.locator('[data-testid="add-repo-btn"]').click();
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const input = page.locator("#add-repo-input");
    await input.fill("facebook/react");
    await input.press("Escape");

    await expect(dialog).toBeHidden();
  });

  test("Tab stays inside the add repo dialog", async ({ page, browserName }) => {
    // WebKit 預設不讓 Tab 停在按鈕與連結上（真 app 由 wry 打開），測試用 Option+Tab 模擬，同 skip-link.spec.ts
    const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
    await page.locator('[data-testid="add-repo-btn"]').click();
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await page.locator("#add-repo-input").fill("facebook/react");

    // 框內可停的是關閉、輸入框、取消、送出四個：按超過一輪，焦點每次都要還在框內，而且四個都停過
    // （只驗「還在框內」的話，Tab 整個被吞掉、焦點卡在輸入框也會過）
    const visited = new Set<string>();
    for (let press = 0; press < 6; press++) {
      await page.keyboard.press(tab);
      const focused = dialog.locator(":focus");
      await expect(focused).toHaveCount(1);
      visited.add(
        await focused.evaluate(
          (el) => el.id || el.getAttribute("aria-label") || el.textContent || ""
        )
      );
    }
    expect(visited.size).toBe(4);
  });

  test("refresh button is disabled when the watchlist is empty", async ({ page }) => {
    // 空清單沒有東西可刷新，設計上按鈕就是 disabled（Toolbar.tsx: totalCount === 0）。
    // 過去這條測試點擊成功，靠的是先前測試殘留的污染資料——那不是可依賴的前提。
    const btn = page.locator('[data-testid="refresh-all-btn"]');
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test("view mode toggle exists", async ({ page }) => {
    await expect(page.locator('[data-testid="view-mode-toggle"]')).toBeVisible();
  });

  test("sort tabs are visible", async ({ page }) => {
    await expect(page.locator('[data-testid="sort-tabs"]')).toBeVisible();
  });

  test("settings page has GitHub connection and alerts sections", async ({ page }) => {
    await page.locator('[data-testid="nav-settings"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="github-section"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="alerts-section"]')).toBeVisible();
  });
});
