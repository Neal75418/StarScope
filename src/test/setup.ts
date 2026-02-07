import "@testing-library/jest-dom";
import { vi } from "vitest";

// Global i18n mock using actual English translations.
// Individual tests can override with their own vi.mock if needed.
vi.mock("../i18n", async () => {
  const { createI18nMock } = await import("./mockI18n");
  return createI18nMock(vi.fn());
});
