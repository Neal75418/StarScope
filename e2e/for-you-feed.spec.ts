/**
 * For You Feed E2E 測試。
 * 驗證 Discovery 預設顯示 feed（或空狀態）、Settings 興趣管理可操作、搜尋時 feed 隱藏。
 */
import { test, expect } from "@playwright/test";
import { removeInterestByTerm } from "./helpers";

// sentinel：絕不與使用者真實興趣撞名；就算清理前恰好觸發 feed 產生，
// 這個 topic 在 GitHub 上也搜不到任何結果，不會污染 feed
const PROBE_TERM = "e2e-probe-interest";

test.describe("For You Feed", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
  });

  test("discovery page defaults to feed or empty state", async ({ page }) => {
    await page.locator('[data-testid="nav-discovery"]').click();
    const feed = page.locator('[data-testid="for-you-feed"]');
    const empty = page.locator('[data-testid="feed-empty-state"]');
    await expect(feed.or(empty)).toBeVisible({ timeout: 15000 });
  });

  test("interests section visible in settings and accepts a term", async ({ page, request }) => {
    await removeInterestByTerm(request, PROBE_TERM); // 上次中斷的殘留會讓新增變成 409
    await page.locator('[data-testid="nav-settings"]').click();
    const section = page.locator('[data-testid="interests-section"]');
    await expect(section).toBeVisible({ timeout: 10000 });

    try {
      await section.locator('[data-testid="interest-term-input"]').fill(PROBE_TERM);
      await section.locator('[data-testid="interest-add-btn"]').click();
      await expect(section.locator(".interest-item", { hasText: PROBE_TERM }).first()).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await removeInterestByTerm(request, PROBE_TERM); // 斷言失敗也不能留在真實 DB
    }
  });

  test("search still works from discovery search bar", async ({ page }) => {
    await page.locator('[data-testid="nav-discovery"]').click();
    // 輸入關鍵字後應切回搜尋結果視圖（feed 隱藏）
    const searchInput = page.locator('[data-testid="discovery-search-input"]');
    await searchInput.fill("rust");
    await page.locator('[data-testid="discovery-search-submit"]').click();
    await expect(page.locator('[data-testid="for-you-feed"]')).toBeHidden({ timeout: 10000 });
  });
});
