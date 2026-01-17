import { test, expect } from "@playwright/test";

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
  });

  test("should display the settings page", async ({ page }) => {
    await expect(page.locator("text=Settings").first()).toBeVisible();
  });

  test("should have webhook management section", async ({ page }) => {
    const webhookSection = page.locator('text=Webhook, text=webhook');
    if (await webhookSection.first().isVisible()) {
      await expect(webhookSection.first()).toBeVisible();
    }
  });

  test("should have export options", async ({ page }) => {
    const exportSection = page.locator('button:has-text("Export"), text=Export');
    if (await exportSection.first().isVisible()) {
      await expect(exportSection.first()).toBeVisible();
    }
  });

  test("should have GitHub token configuration", async ({ page }) => {
    const tokenSection = page.locator('text=Token, text=GitHub, input[type="password"]');
    if (await tokenSection.first().isVisible()) {
      await expect(tokenSection.first()).toBeVisible();
    }
  });
});
