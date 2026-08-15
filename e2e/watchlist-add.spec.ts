/**
 * 「新增 repo 到追蹤清單」的端到端流程。
 *
 * 獨立成一支 spec 的理由：它會往共用 sidecar 的 DB 播種 repo，而
 * dashboard-widgets 的空狀態斷言（stat-card 數量為 0、onboarding 卡片可見）
 * 只要在播種到清理之間的窗口載入就會紅。同一個 project 內不同檔案是不同
 * worker、會平行跑，光靠 browserName skip 擋不住——必須由 playwright.config
 * 的 db-mutating project（串行、單 worker、排在其他 project 之後）獨佔執行。
 */

import { test, expect } from "@playwright/test";
import { FIXTURES, removeRepoByFullName } from "./helpers";

const REPO = FIXTURES.watchlistFlow;

test.describe("Watchlist Add Flow", () => {
  test("can add a repo and see it in the list", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-watchlist"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });

    await removeRepoByFullName(page.request, REPO); // 上次中斷的殘留會讓「新增」變成重複而失敗
    await page.locator('[data-testid="add-repo-btn"]').click();
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await page.locator("#add-repo-input").fill(REPO);
    await dialog.locator('button[type="submit"]').click();

    // 等待 dialog 關閉（成功）
    await expect(dialog).not.toBeVisible({ timeout: 30000 });

    try {
      await expect(page.locator(`text=${REPO}`).first()).toBeVisible({ timeout: 15000 });
    } finally {
      await removeRepoByFullName(page.request, REPO); // 不留資料在（可能是真實的）DB 裡
    }
  });
});
