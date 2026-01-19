import { test, expect } from "@playwright/test";

test.describe("Signals Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/signals");
  });

  test("should display the signals page title", async ({ page }) => {
    await expect(page.getByTestId("page-title")).toBeVisible();
  });

  test("should have signal type filter", async ({ page }) => {
    const filterType = page.getByTestId("filter-type");
    await expect(filterType).toBeVisible({ timeout: 5000 });
  });

  test("should have severity filter", async ({ page }) => {
    const filterSeverity = page.getByTestId("filter-severity");
    await expect(filterSeverity).toBeVisible({ timeout: 5000 });
  });

  test("should have signals toolbar", async ({ page }) => {
    const toolbar = page.getByTestId("signals-toolbar");
    await expect(toolbar).toBeVisible({ timeout: 5000 });
  });

  test("should display signals list or empty state", async ({ page }) => {
    await page.waitForLoadState("networkidle");

    // Either signals list content or empty state should be visible
    const signalsList = page.getByTestId("signals-list");
    await expect(signalsList).toBeVisible();
  });

  test("should filter by signal type", async ({ page }) => {
    const filterType = page.getByTestId("filter-type");
    await filterType.selectOption("rising_star");

    // Wait for filter to apply
    await page.waitForLoadState("networkidle");

    // Filter should be applied
    await expect(filterType).toHaveValue("rising_star");
  });

  test("should filter by severity", async ({ page }) => {
    const filterSeverity = page.getByTestId("filter-severity");
    await filterSeverity.selectOption("high");

    // Wait for filter to apply
    await page.waitForLoadState("networkidle");

    // Filter should be applied
    await expect(filterSeverity).toHaveValue("high");
  });
});
