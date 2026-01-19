import { test, expect } from "@playwright/test";

test.describe("Compare Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/compare");
  });

  test("should display the compare page title", async ({ page }) => {
    await expect(page.getByTestId("page-title")).toBeVisible();
  });

  test("should have create group button", async ({ page }) => {
    const createButton = page.getByTestId("create-group-btn");
    await expect(createButton).toBeVisible({ timeout: 5000 });
  });

  test("should show group list", async ({ page }) => {
    const groupList = page.getByTestId("group-list");
    await expect(groupList).toBeVisible({ timeout: 5000 });
  });

  test("should open create form when clicking create button", async ({ page }) => {
    const createButton = page.getByTestId("create-group-btn");
    await createButton.click();

    // Check for form input
    const nameInput = page.locator('input[placeholder*="name"], input[placeholder*="Name"]');
    await expect(nameInput.first()).toBeVisible({ timeout: 5000 });
  });

  test("should show comparison groups or empty state", async ({ page }) => {
    await page.waitForLoadState("networkidle");

    // Either groups or empty state should be visible
    const groupList = page.getByTestId("group-list");
    await expect(groupList).toBeVisible();
  });
});
