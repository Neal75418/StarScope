import { test, expect, type Locator } from "@playwright/test";
import { SIDECAR } from "./helpers";

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

test.describe("Watchlist batch actions", () => {
  // 追蹤清單用假資料，不寫進共用的 DB；筆數要多到清單超出畫面，操作列才會黏在畫面底部
  const sampleRepos = Array.from({ length: 12 }, (_, index) => {
    const id = index + 1;
    return {
      id,
      owner: "octo",
      name: `repo-${id}`,
      full_name: `octo/repo-${id}`,
      url: `https://github.com/octo/repo-${id}`,
      description: "Sample repository",
      language: "TypeScript",
      added_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-10T00:00:00Z",
      stars: 1200 + id,
      forks: 30,
      stars_delta_1d: 3,
      stars_delta_7d: 20,
      stars_delta_30d: 80,
      velocity: 2.5,
      acceleration: 0.1,
      trend: 1,
      forks_delta_7d: 1,
      forks_delta_30d: 2,
      issues_delta_7d: 0,
      issues_delta_30d: 1,
      last_fetched: "2026-11-14T00:00:00Z",
      category_ids: [],
    };
  });

  const sampleCategories = ["Frontend", "Backend", "Tools", "Reading", "Learning"].map(
    (name, index) => ({
      id: index + 1,
      name,
      description: null,
      icon: null,
      color: null,
      sort_order: index,
      repo_count: 0,
      children: [],
    })
  );

  /** 一顆按鈕或選項的中心點現在點下去會落在誰身上 */
  async function clickTargetAt(control: Locator): Promise<string> {
    return control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return element.contains(hit) ? "itself" : (hit?.className ?? "nothing");
    });
  }

  // 選取全部（操作列出現），再讓 CSV 匯出失敗、跳出一則錯誤 toast
  test.beforeEach(async ({ page }) => {
    await page.route(`${SIDECAR}/api/repos`, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            json: { success: true, data: { repos: sampleRepos, total: sampleRepos.length } },
          })
        : route.continue()
    );
    await page.route(`${SIDECAR}/api/categories/tree`, (route) =>
      route.fulfill({
        json: {
          success: true,
          data: { tree: sampleCategories, total: sampleCategories.length },
        },
      })
    );
    await page.route(`${SIDECAR}/api/export/watchlist.csv`, (route) => route.abort());
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
    await page.locator('[data-testid="nav-watchlist"]').click();
    await page.locator('[data-testid="enter-selection-btn"]').click();
    await page.locator('[data-testid="select-all-btn"]').click();
    await expect(page.locator('[data-testid="batch-action-bar"]')).toBeVisible();

    await page.locator('[data-testid="export-btn"]').click();
    await page.locator('[data-testid="export-menu"] [role="menuitem"]').nth(1).click();
    const toast = page.locator(".toast-error");
    await expect(toast).toBeVisible();
    // 等滑入動畫跑完再量：動畫途中 toast 還沒到定位
    await toast.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished))
    );
  });

  test("a toast does not cover the batch action buttons", async ({ page }) => {
    for (const testId of ["batch-add-to-category", "batch-refresh", "batch-remove"]) {
      const target = await clickTargetAt(page.locator(`[data-testid="${testId}"]`));
      expect(target, `what a click on ${testId} would land on`).toBe("itself");
    }
  });

  test("a toast does not cover the category menu opened from the batch bar", async ({ page }) => {
    // 選單從操作列往上展開，正好伸進 toast 讓位之後的位置
    await page.locator('[data-testid="batch-add-to-category"]').click();
    const options = page.locator('[data-testid="batch-category-picker"] [role="menuitem"]');
    await expect(options).toHaveCount(sampleCategories.length);

    for (const option of await options.all()) {
      const name = await option.textContent();
      expect(await clickTargetAt(option), `what a click on "${name}" would land on`).toBe("itself");
    }
    // toast 還在畫面上：是選單蓋住它，不是它被收掉
    await expect(page.locator(".toast-error")).toBeVisible();
  });
});
