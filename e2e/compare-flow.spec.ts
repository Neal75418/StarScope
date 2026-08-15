/**
 * Compare 頁面 E2E 測試。
 * 驗證 repo 選擇、指標切換與圖表渲染。
 *
 * 前置資料自備：用 API 播種兩個 octocat fixture repo（只清理本次真正新增的），
 * 讓核心測試在乾淨 DB 上也真的執行——舊版靠「watchlist 剛好有 2 個 repo」
 * 否則 skip，在隔離環境等於永遠不跑的死測試。
 */

import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { FIXTURES, addRepoViaApi, isRepoTracked, removeRepoByFullName } from "./helpers";

const [REPO_A, REPO_B] = FIXTURES.compare;

test.describe("Compare Flow", () => {
  // 本 spec 由 playwright.config 的 db-mutating project 獨佔執行
  // （chromium、串行、排在其他 project 之後）——describe 級的 browserName skip
  // 擋不住 beforeAll/afterAll，播種與清理仍會與平行 project 互撞，故用 project 隔離。
  let api: APIRequestContext;
  const seededByUs: string[] = [];

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext();
    for (const fullName of FIXTURES.compare) {
      if (!(await isRepoTracked(api, fullName))) {
        expect(await addRepoViaApi(api, fullName), `seed ${fullName} 失敗`).toBe(true);
        seededByUs.push(fullName);
      }
    }
    // 播種後驗最終狀態：add 回 200 不代表 repo 真的在清單裡
    for (const fullName of FIXTURES.compare) {
      expect(await isRepoTracked(api, fullName), `${fullName} 播種後不在清單`).toBe(true);
    }
  });

  test.afterAll(async () => {
    // 無條件清掉兩個 fixture（不只 seededByUs）：選 octocat 的理由就是「沒有人會
    // 真的追蹤它們」，所以刪掉一定安全；只刪 seededByUs 的話，上次中斷留下的殘留
    // 會因為「已 tracked 所以不播種、也不記錄」而永遠沒有人收，dashboard 的空狀態
    // 斷言從此固定紅。
    for (const fullName of FIXTURES.compare) {
      await removeRepoByFullName(api, fullName);
    }
    await api.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-compare"]').click();
    await expect(page.locator('[data-testid="page-title"]')).toBeVisible({ timeout: 10000 });
  });

  /** 依名稱點選 fixture chip——不能用 nth(0/1)：真實 DB 可能還有使用者自己的 repo。 */
  async function selectFixtureRepos(page: import("@playwright/test").Page) {
    for (const fullName of [REPO_A, REPO_B]) {
      const chip = page.locator(".compare-repo-chip", { hasText: fullName.split("/")[1] });
      await expect(chip.first()).toBeVisible({ timeout: 10000 });
      await chip.first().click();
    }
  }

  test("compare page shows repo selector", async ({ page }) => {
    const selector = page.locator(".compare-selector");
    await expect(selector).toBeVisible({ timeout: 10000 });
  });

  test("shows empty state when no repos selected", async ({ page }) => {
    await expect(page.locator('[data-testid="compare-metric-toggle"]')).not.toBeVisible();
  });

  test("selecting repos shows chart and metrics", async ({ page }) => {
    await selectFixtureRepos(page);

    // 實際的圖表容器 class 是 compare-chart-section（.compare-chart-area 從不存在——
    // 本測試長年被條件 skip，selector 從未被真正執行驗證過）
    const chart = page.locator(".compare-chart-section");
    await expect(chart).toBeVisible({ timeout: 15000 });

    await expect(page.locator('[data-testid="diff-summary-panel"]')).toBeVisible({
      timeout: 10000,
    });
  });

  test("metric toggle changes aria-pressed state", async ({ page }) => {
    await selectFixtureRepos(page);

    const metricToggle = page.locator('[data-testid="compare-metric-toggle"]');
    await expect(metricToggle).toBeVisible({ timeout: 15000 });

    const starsBtn = metricToggle.locator('button:has-text("Stars")');
    await expect(starsBtn).toHaveAttribute("aria-pressed", "true");

    const forksBtn = metricToggle.locator('button:has-text("Forks")');
    await forksBtn.click();
    await expect(forksBtn).toHaveAttribute("aria-pressed", "true");
    await expect(starsBtn).toHaveAttribute("aria-pressed", "false");
  });
});
