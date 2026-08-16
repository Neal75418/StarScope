import { test, expect } from "@playwright/test";

/**
 * 探索頁的搜尋一律攔截，回傳固定資料。
 *
 * 這些測試要驗的是 UI 接線——按下去會不會發搜尋、結果會不會顯示、清空後能不能
 * 再搜一次。打真實 GitHub 只是讓它們額外依賴一個我們控制不了的東西：未認證的
 * 搜尋配額是每分鐘 10 次，而本檔有四條測試都在搜尋，跑一輪就會撞上限
 * （實測 sidecar 日誌：GitHub API rate limit exceeded, remaining: 0）。
 * CI runner 的 IP 還是共用的，配額可能在測試開始前就被別人用掉了。
 *
 * GitHub 整合本身由 sidecar 的單元測試涵蓋，不需要在這裡再賭一次。
 */
function makeRepo(id: number, fullName: string) {
  const [owner, name] = fullName.split("/");
  return {
    id,
    full_name: fullName,
    owner,
    name,
    description: `${name} description`,
    language: "TypeScript",
    stars: 1000 + id,
    forks: 100 + id,
    url: `https://github.com/${fullName}`,
    topics: ["testing"],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    owner_avatar_url: null,
    open_issues_count: 3,
    license_spdx: "MIT",
    license_name: "MIT License",
  };
}

test.describe("Discovery Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/discovery/search*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            repos: [makeRepo(1, "facebook/react"), makeRepo(2, "vuejs/vue")],
            total_count: 2,
            page: 1,
            per_page: 30,
            has_more: false,
          },
          message: null,
          error: null,
        }),
      });
    });

    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-discovery"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
  });

  test("discovery page loads with search bar", async ({ page }) => {
    await expect(page.locator('[data-testid="discovery-search-input"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="discovery-search-submit"]')).toBeVisible();
  });

  test("trending period buttons are visible", async ({ page }) => {
    await expect(page.locator('[data-testid="trending-daily"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="trending-weekly"]')).toBeVisible();
    await expect(page.locator('[data-testid="trending-monthly"]')).toBeVisible();
  });

  test("can search and see results", async ({ page }) => {
    const searchInput = page.locator('[data-testid="discovery-search-input"]');
    await searchInput.fill("react");
    await page.locator('[data-testid="discovery-search-submit"]').click();

    await expect(page.locator('[data-testid^="discovery-result-"]').first()).toBeVisible({ timeout: 15000 });
  });

  test("filter controls are visible", async ({ page }) => {
    await expect(page.locator('[data-testid="discovery-filters"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="filter-language"]')).toBeVisible();
  });

  test("clicking trending period loads results", async ({ page }) => {
    const dailyBtn = page.locator('[data-testid="trending-daily"]');
    await expect(dailyBtn).toBeVisible({ timeout: 10000 });

    await dailyBtn.click();

    await expect(
      page.locator('[data-testid="discovery-results"]').or(page.locator('[data-testid^="discovery-result-"]').first())
    ).toBeVisible({ timeout: 30000 });
  });

  test("search input can be cleared and re-searched", async ({ page }) => {
    const searchInput = page.locator('[data-testid="discovery-search-input"]');
    await searchInput.fill("vue");
    await page.locator('[data-testid="discovery-search-submit"]').click();

    await expect(page.locator('[data-testid^="discovery-result-"]').first()).toBeVisible({ timeout: 15000 });

    await searchInput.clear();
    await searchInput.fill("svelte");
    await page.locator('[data-testid="discovery-search-submit"]').click();

    await expect(page.locator('[data-testid^="discovery-result-"]').first()).toBeVisible({ timeout: 15000 });
  });

  test("filter-only search (language, no keyword) shows results", async ({ page }) => {
    // 清除預設的 trending filter
    const clearBtn = page.locator("button", { hasText: /清除全部|Clear all/i });
    if (await clearBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clearBtn.click();
    }

    // 只選語言（不輸入關鍵字）
    const langSelect = page.locator('[data-testid="filter-language"]');
    await langSelect.selectOption("Python");

    // 等待搜尋結果出現
    await expect(
      page.locator('[data-testid^="discovery-result-"]').first()
    ).toBeVisible({ timeout: 15000 });
  });

});
