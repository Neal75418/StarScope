/**
 * Regression tests for DataManagementSection component.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { DataManagementSection } from "../DataManagementSection";
import { createTestQueryClient } from "../../../lib/react-query";
import { STORAGE_KEYS } from "../../../constants/storage";
import { DATA_RESET_EVENT } from "../../../constants/events";
import * as apiClient from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/client")>();
  return {
    ...actual,
    clearCache: vi.fn(),
    resetAllData: vi.fn(),
  };
});

function renderSection(onToast = vi.fn()) {
  const client = createTestQueryClient();
  return {
    onToast,
    ...render(
      <QueryClientProvider client={client}>
        <DataManagementSection onToast={onToast} />
      </QueryClientProvider>
    ),
  };
}

describe("DataManagementSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps reset confirm dialog open when reset fails", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.resetAllData).mockRejectedValue(new Error("Server error"));
    const { onToast } = renderSection();

    // Open the reset confirm dialog (trigger button in the section)
    const section = screen.getByTestId("data-management-section");
    await user.click(within(section).getByRole("button", { name: /Reset All|重置所有/ }));

    // Confirm dialog should be visible — find confirm button inside the alertdialog
    const dialog = await waitFor(() => screen.getByRole("alertdialog"));
    const confirmBtn = within(dialog).getAllByRole("button")[1]; // second button is confirm

    // Click confirm — reset fails
    await user.click(confirmBtn);

    // Dialog should remain open for retry
    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith(expect.any(String), "error");
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("closes reset confirm dialog on success", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.resetAllData).mockResolvedValue({
      status: "ok",
      deleted_repos: 5,
    });
    const { onToast } = renderSection();

    const section = screen.getByTestId("data-management-section");
    await user.click(within(section).getByRole("button", { name: /Reset All|重置所有/ }));

    const dialog = await waitFor(() => screen.getByRole("alertdialog"));
    const confirmBtn = within(dialog).getAllByRole("button")[1];

    await user.click(confirmBtn);

    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith(expect.any(String), "success");
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("clears data-derived localStorage keys on reset success", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.resetAllData).mockResolvedValue({
      status: "ok",
      deleted_repos: 5,
    });

    // Pre-seed data-derived keys
    localStorage.setItem(STORAGE_KEYS.COMPARE_REPOS, JSON.stringify([1, 2]));
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS_READ, JSON.stringify(["a"]));
    localStorage.setItem(STORAGE_KEYS.DISMISSED_RECS, JSON.stringify(["b"]));
    // Pre-seed a user preference key (should be preserved)
    localStorage.setItem(STORAGE_KEYS.THEME, "dark");

    renderSection();

    const section = screen.getByTestId("data-management-section");
    await user.click(within(section).getByRole("button", { name: /Reset All|重置所有/ }));
    const dialog = await waitFor(() => screen.getByRole("alertdialog"));
    const confirmBtn = within(dialog).getAllByRole("button")[1];
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    // Data-derived keys should be cleared
    expect(localStorage.getItem(STORAGE_KEYS.COMPARE_REPOS)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_READ)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.DISMISSED_RECS)).toBeNull();
    // User preference should be preserved
    expect(localStorage.getItem(STORAGE_KEYS.THEME)).toBe("dark");
  });

  it("dispatches data-reset event on reset success", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.resetAllData).mockResolvedValue({
      status: "ok",
      deleted_repos: 5,
    });

    const eventHandler = vi.fn();
    window.addEventListener(DATA_RESET_EVENT, eventHandler);

    renderSection();

    const section = screen.getByTestId("data-management-section");
    await user.click(within(section).getByRole("button", { name: /Reset All|重置所有/ }));
    const dialog = await waitFor(() => screen.getByRole("alertdialog"));
    const confirmBtn = within(dialog).getAllByRole("button")[1];
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(eventHandler).toHaveBeenCalledTimes(1);
    });

    window.removeEventListener(DATA_RESET_EVENT, eventHandler);
  });
});
