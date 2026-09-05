import { test, expect } from "@playwright/test";

/**
 * 跳至主要內容（skip link）——鍵盤使用者略過整排導覽列的唯一入口。
 *
 * 這條鏈結平時是隱形的（clip-path 藏起來，只有 :focus 才顯示），所以它壞掉
 * 不會有任何人發現：畫面看起來完全正常，只有靠鍵盤操作的人會突然發現每次
 * 進頁面都要按十幾次 Tab 才到得了內容。
 *
 * 只讀不寫，不需要進 DB_MUTATING_SPECS。
 */
test.describe("Skip to content", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
  });

  // WebKit（Safari 與 macOS app 用的 WKWebView）預設不把連結放進 Tab 順序，要用
  // Option+Tab 才會停在連結上；Chromium / Firefox 的 Tab 就會。本機跑三個引擎時
  // 這兩條先前在 WebKit 一律紅，CI 只跑 Chromium 所以沒被看見。
  // 在真正的 app 裡，使用者開了 macOS 的「鍵盤導覽」（Full Keyboard Access）
  // 之後 Tab 才會停在連結上——鍵盤使用者通常會開，測試用 Option+Tab 模擬同一件事。
  const tabToLink = (browserName: string) => (browserName === "webkit" ? "Alt+Tab" : "Tab");

  test("是第一個可聚焦元素，且聚焦時才顯示", async ({ page, browserName }) => {
    const link = page.locator("a.skip-to-content");
    // 未聚焦時被 clip 起來：Playwright 的 toBeVisible 對 clip-path 隱藏不敏感，
    // 所以量實際尺寸——這正是「視覺隱藏」與「顯示」的差別所在
    const hiddenBox = await link.boundingBox();
    expect(hiddenBox?.width ?? 0).toBeLessThan(5);

    await page.keyboard.press(tabToLink(browserName));

    await expect(link).toBeFocused();
    const shownBox = await link.boundingBox();
    expect(shownBox?.width ?? 0).toBeGreaterThan(50);
  });

  test("錨點指向真實存在的 main，按下會導向它", async ({ page, browserName }) => {
    await page.keyboard.press(tabToLink(browserName));
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/#main-content$/);

    // 這才是會壞的地方：連結寫在 AppHeader、目標 id 寫在 App，兩個檔案。
    // 有人改了 <main> 的 id 或把它拿掉時，畫面完全正常，只有鍵盤使用者
    // 會踩到一個跳去空氣的連結。IDE 也抓不到（它只在單一檔案內解析錨點）
    const target = page.locator("main#main-content");
    await expect(target).toHaveCount(1);
  });

  // 刻意沒有斷言「按下之後 Tab 會落在 main 內」。
  // 那個行為靠瀏覽器的「循序焦點導覽起點」，headless Chromium 沒有實作：
  // 實測 headed 會落在 main 內的 widget-customizer-btn，headless 則退回
  // skip link 本身。CI 跑 headless，寫進去只會得到一條假紅。
  // 真實使用者（Tauri 的 headed webview）行為正確，已於 2026-09-02 手動驗證。
});
