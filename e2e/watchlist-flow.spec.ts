import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// e2e 可能重用開發者本機正在跑的 sidecar（reuseExistingServer），寫入的是真實資料庫——
// 所以任何會新增資料的測試必須自我清理，且開跑前先清一次殘留（讓重跑冪等）。
// 本檔的測試會對共用的 sidecar 寫入/刪除資料，fullyParallel 下同檔測試
// 各自平行執行會互相踩到（新增中的 repo 被另一條測試的清理刪掉等）——改回循序。
test.describe.configure({ mode: "default" });

const SIDECAR = "http://127.0.0.1:8008";
async function removeRepoIfExists(page: Page, fullName: string) {
  const res = await page.request.get(`${SIDECAR}/api/repos`);
  if (!res.ok()) return;
  const body = await res.json();
  const hit = body?.data?.repos?.find(
    (r: { id: number; full_name: string }) => r.full_name === fullName
  );
  if (hit) await page.request.delete(`${SIDECAR}/api/repos/${hit.id}`);
}

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

  test("can add a repo and see it in the list", async ({ page }) => {
    await removeRepoIfExists(page, "vitejs/vite"); // 上次中斷的殘留會讓「新增」變成重複而失敗
    await page.locator('[data-testid="add-repo-btn"]').click();
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await page.locator("#add-repo-input").fill("vitejs/vite");
    await dialog.locator('button[type="submit"]').click();

    // 等待 dialog 關閉（成功）
    await expect(dialog).not.toBeVisible({ timeout: 30000 });

    // 驗證 repo 出現
    try {
      await expect(page.locator("text=vitejs/vite").first()).toBeVisible({ timeout: 15000 });
    } finally {
      await removeRepoIfExists(page, "vitejs/vite"); // 不留資料在（可能是真實的）DB 裡
    }
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
