import { test, expect } from "@playwright/test";

test.describe("Trends Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/trends");
  });

  test("should display the trends page title", async ({ page }) => {
    await expect(page.getByTestId("page-title")).toBeVisible();
  });

  test("should have sort tabs", async ({ page }) => {
    const sortTabs = page.getByTestId("sort-tabs");
    await expect(sortTabs).toBeVisible({ timeout: 5000 });
  });

  test("should have velocity sort option", async ({ page }) => {
    const velocitySort = page.getByTestId("sort-velocity");
    await expect(velocitySort).toBeVisible({ timeout: 5000 });
  });

  test("should switch sort options", async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState("networkidle");

    // Click 7d sort
    const sort7d = page.getByTestId("sort-stars_delta_7d");
    if (await sort7d.isVisible()) {
      await sort7d.click();
      await expect(sort7d).toHaveClass(/active/);
    }
  });

  test("should display trends table or empty state", async ({ page }) => {
    await page.waitForLoadState("networkidle");

    // Either trends table or empty state should be visible
    const trendsTable = page.getByTestId("trends-table");
    const emptyState = page.getByTestId("empty-state");

    const tableVisible = await trendsTable.isVisible().catch(() => false);
    const emptyVisible = await emptyState.isVisible().catch(() => false);

    expect(tableVisible || emptyVisible).toBeTruthy();
  });
});
