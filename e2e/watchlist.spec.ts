import { test, expect } from "@playwright/test";

test.describe("Watchlist Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display the watchlist page", async ({ page }) => {
    await expect(page.getByTestId("page-title")).toBeVisible();
  });

  test("should show empty state or repo list", async ({ page }) => {
    // Check for either repo list or empty state
    const repoList = page.getByTestId("repo-list");
    await expect(repoList).toBeVisible();
  });

  test("should have add repo button", async ({ page }) => {
    const addButton = page.getByTestId("add-repo-btn");
    await expect(addButton).toBeVisible();
  });

  test("should open add repo dialog when clicking add button", async ({ page }) => {
    const addButton = page.getByTestId("add-repo-btn");
    await addButton.click();
    // Check for dialog input field
    await expect(
      page.locator('input[placeholder*="owner"], input[placeholder*="repo"]').first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("should navigate to trends page", async ({ page }) => {
    const trendsNav = page.getByTestId("nav-trends");
    await trendsNav.click();
    await expect(page).toHaveURL(/trends/);
  });

  test("should navigate to discovery page", async ({ page }) => {
    const discoveryNav = page.getByTestId("nav-discovery");
    await discoveryNav.click();
    await expect(page).toHaveURL(/discovery/);
  });

  test("should toggle theme", async ({ page }) => {
    const themeToggle = page.getByTestId("theme-toggle");
    await expect(themeToggle).toBeVisible();

    // Get initial theme
    const html = page.locator("html");
    const initialTheme = await html.getAttribute("data-theme");

    // Click theme toggle
    await themeToggle.click();

    // Theme should change
    const newTheme = await html.getAttribute("data-theme");
    expect(newTheme).not.toBe(initialTheme);
  });

  test("should toggle language", async ({ page }) => {
    const langToggle = page.getByTestId("lang-toggle");
    await expect(langToggle).toBeVisible();

    // Get initial language indicator
    const initialLang = await langToggle.textContent();

    // Click language toggle
    await langToggle.click();

    // Language should change
    const newLang = await langToggle.textContent();
    expect(newLang).not.toBe(initialLang);
  });
});
